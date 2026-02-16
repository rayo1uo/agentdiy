import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLOR_OPTIONS,
  type Annotation,
  type AnnotationCreateInput
} from "@/shared/annotation";
import type { AnnotationChangedEvent, AnnotationListResponse, RuntimeRequest } from "@/shared/messages";
import { sendRuntimeMessage } from "@/lib/runtime";
import { extractPosition, focusAnnotation, getQuoteContextByOffsets, renderAnnotations } from "./highlight";
import "./styles.css";

const TOOLBAR_CLASS = "annota-toolbar";
const TOOLBAR_GAP = 8;
const VIEWPORT_MARGIN = 8;
const RENDER_RETRY_DELAYS_MS = [300, 900, 1800, 3200] as const;
const FOCUS_RETRY_DELAYS_MS = [200, 600, 1200, 2200] as const;
const DOM_OBSERVER_WINDOW_MS = 15000;
const DOM_RENDER_DEBOUNCE_MS = 180;
const SETTINGS_KEY_TOOLBAR_OPACITY = "settings:toolbarOpacity";
const SETTINGS_KEY_TOOLBAR_WIDTH = "settings:toolbarWidth";
const SETTINGS_KEY_API_BASE = "settings:apiBaseUrl";
const AUTH_KEY_ACCESS_TOKEN = "auth:accessToken";
const AUTH_KEY_REFRESH_TOKEN = "auth:refreshToken";
const TOOLBAR_OPACITY_MIN = 0.55;
const TOOLBAR_OPACITY_MAX = 1;
const TOOLBAR_WIDTH_MIN = 240;
const TOOLBAR_WIDTH_MAX = 520;
const STORAGE_REFRESH_DEBOUNCE_MS = 180;

type SelectionDraft = {
  quoteText: string;
  prefixText: string;
  suffixText: string;
  startOffset: number;
  endOffset: number;
};

type ToolbarPreferences = {
  opacity: number;
  width: number;
};

let toolbar: HTMLDivElement | null = null;
let activeDraft: SelectionDraft | null = null;
let latestAnnotations: Annotation[] = [];
let renderRetryTimers: number[] = [];
let mutationObserver: MutationObserver | null = null;
let mutationObserverStopTimer: number | null = null;
let mutationRenderTimer: number | null = null;
let storageRefreshTimer: number | null = null;
let toolbarPreferences: ToolbarPreferences = {
  opacity: 0.92,
  width: 320
};

const currentURL = (): string => window.location.href;
const pageTitle = (): string => document.title;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const hideToolbar = (): void => {
  toolbar?.remove();
  toolbar = null;
  activeDraft = null;
};

const applyToolbarPreferences = (element: HTMLDivElement): void => {
  element.style.setProperty("--annota-toolbar-opacity", toolbarPreferences.opacity.toFixed(2));
  element.style.setProperty("--annota-toolbar-width", `${Math.round(toolbarPreferences.width)}px`);
};

const loadToolbarPreferences = async (): Promise<void> => {
  const data = await chrome.storage.sync.get([SETTINGS_KEY_TOOLBAR_OPACITY, SETTINGS_KEY_TOOLBAR_WIDTH]);
  const opacityValue = data[SETTINGS_KEY_TOOLBAR_OPACITY];
  const widthValue = data[SETTINGS_KEY_TOOLBAR_WIDTH];

  if (typeof opacityValue === "number") {
    toolbarPreferences.opacity = clamp(opacityValue, TOOLBAR_OPACITY_MIN, TOOLBAR_OPACITY_MAX);
  }
  if (typeof widthValue === "number") {
    toolbarPreferences.width = clamp(widthValue, TOOLBAR_WIDTH_MIN, TOOLBAR_WIDTH_MAX);
  }
};

const onToolbarPreferenceChanged = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string): void => {
  if (areaName !== "sync") {
    return;
  }

  const opacityChange = changes[SETTINGS_KEY_TOOLBAR_OPACITY];
  if (opacityChange && typeof opacityChange.newValue === "number") {
    toolbarPreferences.opacity = clamp(opacityChange.newValue, TOOLBAR_OPACITY_MIN, TOOLBAR_OPACITY_MAX);
  }

  const widthChange = changes[SETTINGS_KEY_TOOLBAR_WIDTH];
  if (widthChange && typeof widthChange.newValue === "number") {
    toolbarPreferences.width = clamp(widthChange.newValue, TOOLBAR_WIDTH_MIN, TOOLBAR_WIDTH_MAX);
  }

  if (toolbar) {
    applyToolbarPreferences(toolbar);
  }
};

const getCurrentSelectionRange = (): Range | null => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const text = selection.toString().trim();
  if (!text) {
    return null;
  }

  return range;
};

const clearRenderRetryTimers = (): void => {
  for (const timerID of renderRetryTimers) {
    window.clearTimeout(timerID);
  }
  renderRetryTimers = [];
};

const scheduleStorageDrivenRefresh = (): void => {
  if (storageRefreshTimer !== null) {
    window.clearTimeout(storageRefreshTimer);
  }
  storageRefreshTimer = window.setTimeout(() => {
    storageRefreshTimer = null;
    void refreshAnnotations();
  }, STORAGE_REFRESH_DEBOUNCE_MS);
};

const onExtensionStorageChanged = (
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string
): void => {
  onToolbarPreferenceChanged(changes, areaName);

  if (areaName === "sync" && changes[SETTINGS_KEY_API_BASE]) {
    scheduleStorageDrivenRefresh();
    return;
  }

  if (areaName !== "local") {
    return;
  }

  const authChanged = Boolean(changes[AUTH_KEY_ACCESS_TOKEN] || changes[AUTH_KEY_REFRESH_TOKEN]);
  const currentAnnotationKey = `annotations:${currentURL()}`;
  const currentURLAnnotationsChanged = Object.prototype.hasOwnProperty.call(changes, currentAnnotationKey);

  if (authChanged || currentURLAnnotationsChanged) {
    scheduleStorageDrivenRefresh();
  }
};

const stopMutationObserver = (): void => {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
  if (mutationObserverStopTimer !== null) {
    window.clearTimeout(mutationObserverStopTimer);
    mutationObserverStopTimer = null;
  }
  if (mutationRenderTimer !== null) {
    window.clearTimeout(mutationRenderTimer);
    mutationRenderTimer = null;
  }
};

const renderLatestAnnotations = (): { renderedCount: number; totalCount: number } => {
  const rendered = renderAnnotations(latestAnnotations);
  return { renderedCount: rendered.length, totalCount: latestAnnotations.length };
};

const startMutationObserver = (): void => {
  if (mutationObserver || !document.body || latestAnnotations.length === 0) {
    return;
  }

  mutationObserver = new MutationObserver(() => {
    if (mutationRenderTimer !== null) {
      return;
    }

    mutationRenderTimer = window.setTimeout(() => {
      mutationRenderTimer = null;
      const { renderedCount, totalCount } = renderLatestAnnotations();
      if (renderedCount >= totalCount) {
        stopMutationObserver();
      }
    }, DOM_RENDER_DEBOUNCE_MS);
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  mutationObserverStopTimer = window.setTimeout(() => {
    stopMutationObserver();
  }, DOM_OBSERVER_WINDOW_MS);
};

const scheduleRenderRetries = (): void => {
  clearRenderRetryTimers();

  for (const delay of RENDER_RETRY_DELAYS_MS) {
    const timerID = window.setTimeout(() => {
      const { renderedCount, totalCount } = renderLatestAnnotations();
      if (renderedCount >= totalCount) {
        stopMutationObserver();
      }
    }, delay);
    renderRetryTimers.push(timerID);
  }
};

const refreshAnnotations = async (): Promise<{ renderedCount: number; totalCount: number }> => {
  const result = await sendRuntimeMessage<AnnotationListResponse>({
    type: "annotation.list",
    payload: { url: currentURL() }
  });

  latestAnnotations = result.annotations;
  const stats = renderLatestAnnotations();
  if (stats.renderedCount < stats.totalCount) {
    startMutationObserver();
    scheduleRenderRetries();
  } else {
    stopMutationObserver();
    clearRenderRetryTimers();
  }
  return stats;
};

const focusAnnotationWithRecovery = async (annotationID: string): Promise<void> => {
  if (focusAnnotation(annotationID)) {
    return;
  }

  try {
    await refreshAnnotations();
  } catch {
    return;
  }

  if (focusAnnotation(annotationID)) {
    return;
  }

  for (const delay of FOCUS_RETRY_DELAYS_MS) {
    await sleep(delay);
    if (focusAnnotation(annotationID)) {
      return;
    }
  }
};

const createAnnotation = async (
  draft: SelectionDraft | null,
  options?: { color?: string; commentText?: string }
): Promise<void> => {
  if (!draft) {
    hideToolbar();
    return;
  }

  const payload: AnnotationCreateInput = {
    url: currentURL(),
    title: pageTitle(),
    quoteText: draft.quoteText,
    prefixText: draft.prefixText,
    suffixText: draft.suffixText,
    startOffset: draft.startOffset,
    endOffset: draft.endOffset,
    color: options?.color ?? DEFAULT_HIGHLIGHT_COLOR,
    commentText: options?.commentText ?? ""
  };

  await sendRuntimeMessage<Annotation>({
    type: "annotation.create",
    payload
  });

  hideToolbar();
  window.getSelection()?.removeAllRanges();
  await refreshAnnotations();
};

const updateAnnotationComment = async (
  annotationID: string,
  commentText: string,
  color?: string
): Promise<void> => {
  await sendRuntimeMessage<Annotation>({
    type: "annotation.updateComment",
    payload: {
      url: currentURL(),
      id: annotationID,
      commentText,
      color
    }
  });

  hideToolbar();
  await refreshAnnotations();
};

const buildActionButton = (label: string, kind: "primary" | "ghost", onClick: () => Promise<void>): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.kind = kind;
  button.textContent = label;
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  button.addEventListener("click", () => {
    void onClick();
  });
  return button;
};

const computeToolbarPosition = (
  rect: DOMRect,
  toolbarElement: HTMLDivElement
): { top: number; left: number } => {
  const width = toolbarElement.offsetWidth;
  const height = toolbarElement.offsetHeight;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  const minLeft = scrollX + VIEWPORT_MARGIN;
  const maxLeft = scrollX + window.innerWidth - width - VIEWPORT_MARGIN;
  const centerLeft = scrollX + rect.left + rect.width / 2 - width / 2;
  const left = Math.min(Math.max(centerLeft, minLeft), Math.max(minLeft, maxLeft));

  const minTop = scrollY + VIEWPORT_MARGIN;
  const maxTop = scrollY + window.innerHeight - height - VIEWPORT_MARGIN;
  const aboveTop = scrollY + rect.top - height - TOOLBAR_GAP;
  const belowTop = scrollY + rect.bottom + TOOLBAR_GAP;

  let top = aboveTop;
  if (aboveTop < minTop && belowTop <= maxTop) {
    top = belowTop;
  } else if (aboveTop < minTop && belowTop > maxTop) {
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    top = spaceBelow >= spaceAbove ? belowTop : aboveTop;
  }
  top = Math.min(Math.max(top, minTop), Math.max(minTop, maxTop));

  return { top, left };
};

const buildColorRow = (selectedColor: string, onSelect?: (value: string) => void): HTMLDivElement => {
  const colorRow = document.createElement("div");
  colorRow.className = "annota-color-row";

  const applySelectedColor = (): void => {
    colorRow.querySelectorAll<HTMLButtonElement>(".annota-color-btn").forEach((button) => {
      button.dataset.active = button.dataset.color === selectedColor ? "true" : "false";
    });
  };

  for (const color of HIGHLIGHT_COLOR_OPTIONS) {
    const colorButton = document.createElement("button");
    colorButton.type = "button";
    colorButton.className = "annota-color-btn";
    colorButton.dataset.color = color;
    colorButton.setAttribute("aria-label", `选择颜色 ${color}`);
    colorButton.style.backgroundColor = color;
    colorButton.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    colorButton.addEventListener("click", () => {
      if (!onSelect) {
        return;
      }
      onSelect(color);
      selectedColor = color;
      applySelectedColor();
    });
    colorRow.appendChild(colorButton);
  }
  applySelectedColor();

  return colorRow;
};

const showCreateToolbar = (range: Range): void => {
  hideToolbar();

  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return;
  }

  const selectedText = range.toString().trim();
  const position = extractPosition(range);
  if (!selectedText || !position) {
    hideToolbar();
    return;
  }

  const { prefixText, suffixText } = getQuoteContextByOffsets(position.startOffset, position.endOffset);
  activeDraft = {
    quoteText: selectedText,
    prefixText,
    suffixText,
    startOffset: position.startOffset,
    endOffset: position.endOffset
  };

  const nextToolbar = document.createElement("div");
  nextToolbar.className = TOOLBAR_CLASS;
  applyToolbarPreferences(nextToolbar);
  nextToolbar.addEventListener("mouseup", (event) => {
    event.stopPropagation();
  });

  const heading = document.createElement("div");
  heading.className = "annota-toolbar-title";
  heading.textContent = "高亮与评论";

  let selectedColor: string = DEFAULT_HIGHLIGHT_COLOR;
  const colorRow = buildColorRow(selectedColor, (color) => {
    selectedColor = color;
  });

  const commentInput = document.createElement("textarea");
  commentInput.className = "annota-comment-input";
  commentInput.placeholder = "可选：输入评论";
  commentInput.rows = 3;
  commentInput.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });

  const errorText = document.createElement("div");
  errorText.className = "annota-toolbar-error";
  errorText.hidden = true;

  const setError = (message: string): void => {
    errorText.textContent = message;
    errorText.hidden = message.trim() === "";
  };

  const actionRow = document.createElement("div");
  actionRow.className = "annota-action-row";

  const cancelButton = buildActionButton("取消", "ghost", async () => {
    hideToolbar();
  });

  const highlightOnlyButton = buildActionButton("仅高亮", "ghost", async () => {
    setError("");
    highlightOnlyButton.disabled = true;
    saveCommentButton.disabled = true;
    const previousText = highlightOnlyButton.textContent;
    highlightOnlyButton.textContent = "保存中...";
    try {
      await createAnnotation(activeDraft, { color: selectedColor, commentText: "" });
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存高亮失败");
    } finally {
      highlightOnlyButton.disabled = false;
      saveCommentButton.disabled = false;
      highlightOnlyButton.textContent = previousText;
    }
  });

  const saveCommentButton = buildActionButton("保存评论", "primary", async () => {
    const comment = commentInput.value.trim();
    if (!comment) {
      setError("评论不能为空");
      commentInput.focus();
      return;
    }

    setError("");
    highlightOnlyButton.disabled = true;
    saveCommentButton.disabled = true;
    const previousText = saveCommentButton.textContent;
    saveCommentButton.textContent = "保存中...";
    try {
      await createAnnotation(activeDraft, { color: selectedColor, commentText: comment });
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存评论失败");
    } finally {
      highlightOnlyButton.disabled = false;
      saveCommentButton.disabled = false;
      saveCommentButton.textContent = previousText;
    }
  });

  commentInput.addEventListener("input", () => {
    if (errorText.hidden) {
      return;
    }
    if (commentInput.value.trim()) {
      setError("");
    }
  });

  commentInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hideToolbar();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void saveCommentButton.click();
    }
  });

  actionRow.append(cancelButton, highlightOnlyButton, saveCommentButton);
  nextToolbar.append(heading, colorRow, commentInput, errorText, actionRow);
  document.body.appendChild(nextToolbar);

  const { top, left } = computeToolbarPosition(rect, nextToolbar);

  nextToolbar.style.top = `${top}px`;
  nextToolbar.style.left = `${left}px`;

  toolbar = nextToolbar;
};

const escapeForAttributeSelector = (value: string): string => {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/"/g, '\\"');
};

const findAnnotationAnchorRect = (annotationID: string): DOMRect | null => {
  const escaped = escapeForAttributeSelector(annotationID);
  const elements = Array.from(document.querySelectorAll<HTMLElement>(`[data-anno-id="${escaped}"]`));
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return rect;
    }
  }
  return null;
};

const showEditToolbar = (annotation: Annotation, anchorRect: DOMRect): void => {
  hideToolbar();

  const nextToolbar = document.createElement("div");
  nextToolbar.className = TOOLBAR_CLASS;
  applyToolbarPreferences(nextToolbar);

  const heading = document.createElement("div");
  heading.className = "annota-toolbar-title";
  heading.textContent = "高亮与评论";

  const subtitle = document.createElement("div");
  subtitle.className = "annota-toolbar-subtitle";
  subtitle.textContent = "编辑评论";

  const quotePreview = document.createElement("div");
  quotePreview.className = "annota-edit-quote";
  quotePreview.style.setProperty("--annota-highlight-color", annotation.color);
  quotePreview.textContent = annotation.quoteText;

  let selectedColor = annotation.color;
  const colorRow = buildColorRow(selectedColor, (color) => {
    selectedColor = color;
    quotePreview.style.setProperty("--annota-highlight-color", color);
  });

  const commentInput = document.createElement("textarea");
  commentInput.className = "annota-comment-input";
  commentInput.placeholder = "请输入评论（可为空）";
  commentInput.value = annotation.commentText ?? "";
  commentInput.rows = 4;

  const errorText = document.createElement("div");
  errorText.className = "annota-toolbar-error";
  errorText.hidden = true;

  const setError = (message: string): void => {
    errorText.textContent = message;
    errorText.hidden = message.trim() === "";
  };

  let saving = false;
  const actionRow = document.createElement("div");
  actionRow.className = "annota-action-row";

  const cancelButton = buildActionButton("取消", "ghost", async () => {
    if (saving) {
      return;
    }
    hideToolbar();
  });

  const saveButton = buildActionButton("保存评论", "primary", async () => {
    if (saving) {
      return;
    }
    saving = true;
    setError("");
    cancelButton.disabled = true;
    saveButton.disabled = true;
    const previous = saveButton.textContent;
    saveButton.textContent = "保存中...";
    try {
      await updateAnnotationComment(annotation.id, commentInput.value, selectedColor);
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存评论失败");
    } finally {
      saving = false;
      cancelButton.disabled = false;
      saveButton.disabled = false;
      saveButton.textContent = previous;
    }
  });

  commentInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void cancelButton.click();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void saveButton.click();
    }
  });

  actionRow.append(cancelButton, saveButton);
  nextToolbar.append(heading, subtitle, colorRow, quotePreview, commentInput, errorText, actionRow);
  document.body.appendChild(nextToolbar);

  const { top, left } = computeToolbarPosition(anchorRect, nextToolbar);
  nextToolbar.style.top = `${top}px`;
  nextToolbar.style.left = `${left}px`;

  toolbar = nextToolbar;
  window.setTimeout(() => {
    commentInput.focus();
    const length = commentInput.value.length;
    commentInput.setSelectionRange(length, length);
  }, 0);
};

const openEditCommentForAnnotation = async (annotationID: string): Promise<void> => {
  if (latestAnnotations.length === 0) {
    try {
      await refreshAnnotations();
    } catch {
      return;
    }
  }

  let target = latestAnnotations.find((item) => item.id === annotationID) ?? null;
  if (!target) {
    try {
      await refreshAnnotations();
      target = latestAnnotations.find((item) => item.id === annotationID) ?? null;
    } catch {
      return;
    }
  }
  if (!target) {
    return;
  }

  let rect = findAnnotationAnchorRect(annotationID);
  if (!rect) {
    await focusAnnotationWithRecovery(annotationID);
    await sleep(80);
    rect = findAnnotationAnchorRect(annotationID);
  }
  if (!rect) {
    try {
      await refreshAnnotations();
    } catch {
      return;
    }
    rect = findAnnotationAnchorRect(annotationID);
  }
  if (!rect) {
    return;
  }

  showEditToolbar(target, rect);
};

const selectionHandler = (event: MouseEvent): void => {
  const target = event.target as HTMLElement | null;
  if (toolbar && target && target.closest(`.${TOOLBAR_CLASS}`)) {
    return;
  }

  const range = getCurrentSelectionRange();
  if (!range) {
    const annotationID = target?.closest<HTMLElement>(".annota-highlight")?.dataset.annoId?.trim() ?? "";
    if (annotationID) {
      void openEditCommentForAnnotation(annotationID);
      return;
    }
    hideToolbar();
    return;
  }

  showCreateToolbar(range);
};

const onRuntimeMessage = (message: RuntimeRequest | AnnotationChangedEvent): void => {
  if (message.type === "annotation.changed" && message.payload.url === currentURL()) {
    void refreshAnnotations();
    return;
  }

  if (message.type === "annotation.refresh" && message.payload.url === currentURL()) {
    void refreshAnnotations();
    return;
  }

  if (message.type === "annotation.refreshAll") {
    void refreshAnnotations();
    return;
  }

  if (message.type === "annotation.focus") {
    void focusAnnotationWithRecovery(message.payload.id);
    return;
  }

  if (message.type === "annotation.editComment") {
    if (message.payload.url && message.payload.url !== currentURL()) {
      return;
    }
    void openEditCommentForAnnotation(message.payload.id);
  }
};

const bootstrap = async (): Promise<void> => {
  document.addEventListener("mouseup", selectionHandler);
  document.addEventListener("scroll", hideToolbar, true);
  document.addEventListener("mousedown", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target || !target.closest(`.${TOOLBAR_CLASS}`)) {
      hideToolbar();
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    onRuntimeMessage(message as RuntimeRequest | AnnotationChangedEvent);
  });
  chrome.storage.onChanged.addListener(onExtensionStorageChanged);

  await loadToolbarPreferences();

  try {
    await refreshAnnotations();
  } catch {
    // Ignore initial load errors in content script; page can still function and retry later.
  }
};

void bootstrap();
