import { DEFAULT_HIGHLIGHT_COLOR, type Annotation, type AnnotationCreateInput } from "@/shared/annotation";
import type { AnnotationChangedEvent, AnnotationListResponse, RuntimeRequest } from "@/shared/messages";
import { sendRuntimeMessage } from "@/lib/runtime";
import { extractPosition, focusAnnotation, renderAnnotations } from "./highlight";
import "./styles.css";

const TOOLBAR_CLASS = "annota-toolbar";
const COLOR_OPTIONS = ["#ffe58f", "#ffd6e7", "#c7f9cc", "#bfdbfe", "#e9d5ff"];
const TOOLBAR_GAP = 8;
const VIEWPORT_MARGIN = 8;
const RENDER_RETRY_DELAYS_MS = [300, 900, 1800, 3200] as const;
const FOCUS_RETRY_DELAYS_MS = [200, 600, 1200, 2200] as const;
const DOM_OBSERVER_WINDOW_MS = 15000;
const DOM_RENDER_DEBOUNCE_MS = 180;

type SelectionDraft = {
  quoteText: string;
  prefixText: string;
  suffixText: string;
  startOffset: number;
  endOffset: number;
};

let toolbar: HTMLDivElement | null = null;
let activeDraft: SelectionDraft | null = null;
let latestAnnotations: Annotation[] = [];
let renderRetryTimers: number[] = [];
let mutationObserver: MutationObserver | null = null;
let mutationObserverStopTimer: number | null = null;
let mutationRenderTimer: number | null = null;

const currentURL = (): string => window.location.href;
const pageTitle = (): string => document.title;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

const getQuoteContext = (selectedText: string): { prefixText: string; suffixText: string } => {
  const bodyText = document.body.innerText || "";
  const index = bodyText.indexOf(selectedText);

  if (index < 0) {
    return { prefixText: "", suffixText: "" };
  }

  const contextLength = 32;
  const prefixStart = Math.max(0, index - contextLength);
  const suffixEnd = Math.min(bodyText.length, index + selectedText.length + contextLength);

  return {
    prefixText: bodyText.slice(prefixStart, index),
    suffixText: bodyText.slice(index + selectedText.length, suffixEnd)
  };
};

const hideToolbar = (): void => {
  toolbar?.remove();
  toolbar = null;
  activeDraft = null;
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

const showToolbar = (range: Range): void => {
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

  const { prefixText, suffixText } = getQuoteContext(selectedText);
  activeDraft = {
    quoteText: selectedText,
    prefixText,
    suffixText,
    startOffset: position.startOffset,
    endOffset: position.endOffset
  };

  const nextToolbar = document.createElement("div");
  nextToolbar.className = TOOLBAR_CLASS;
  nextToolbar.addEventListener("mouseup", (event) => {
    event.stopPropagation();
  });

  const heading = document.createElement("div");
  heading.className = "annota-toolbar-title";
  heading.textContent = "高亮与评论";

  const colorRow = document.createElement("div");
  colorRow.className = "annota-color-row";
  let selectedColor = DEFAULT_HIGHLIGHT_COLOR;

  const applySelectedColor = (): void => {
    colorRow.querySelectorAll<HTMLButtonElement>(".annota-color-btn").forEach((button) => {
      button.dataset.active = button.dataset.color === selectedColor ? "true" : "false";
    });
  };

  for (const color of COLOR_OPTIONS) {
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
      selectedColor = color;
      applySelectedColor();
    });
    colorRow.appendChild(colorButton);
  }
  applySelectedColor();

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

const selectionHandler = (event: MouseEvent): void => {
  const target = event.target as HTMLElement | null;
  if (toolbar && target && target.closest(`.${TOOLBAR_CLASS}`)) {
    return;
  }

  const range = getCurrentSelectionRange();
  if (!range) {
    hideToolbar();
    return;
  }

  showToolbar(range);
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

  if (message.type === "annotation.focus") {
    void focusAnnotationWithRecovery(message.payload.id);
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

  try {
    await refreshAnnotations();
  } catch {
    // Ignore initial load errors in content script; page can still function and retry later.
  }
};

void bootstrap();
