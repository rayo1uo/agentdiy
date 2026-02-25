import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLOR_OPTIONS,
  type Annotation,
  type AnnotationCreateInput
} from "@/shared/annotation";
import type { AnnotationChangedEvent, AnnotationListResponse, RuntimeRequest } from "@/shared/messages";
import { sendRuntimeMessage } from "@/lib/runtime";
import { createMarkdownEditorWidget, type MarkdownEditorWidget } from "./markdown_editor";
import { clearHighlights, extractPosition, focusAnnotation, getQuoteContextByOffsets, renderAnnotations } from "./highlight";
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
const SETTINGS_KEY_DIALOG_DEFAULT_ENABLED = "settings:dialogDefaultEnabled";
const SETTINGS_KEY_DIALOG_SITE_MAP = "settings:dialogSiteEnabledMap";
const SETTINGS_KEY_DIALOG_LEGACY_ENABLED = "settings:dialogEnabledByAction";
const SETTINGS_KEY_API_BASE = "settings:apiBaseUrl";
const AUTH_KEY_ACCESS_TOKEN = "auth:accessToken";
const AUTH_KEY_REFRESH_TOKEN = "auth:refreshToken";
const TOOLBAR_OPACITY_MIN = 0.55;
const TOOLBAR_OPACITY_MAX = 1;
const TOOLBAR_WIDTH_MIN = 240;
const TOOLBAR_WIDTH_MAX = 520;
const STORAGE_REFRESH_DEBOUNCE_MS = 180;
const TOOLBAR_REOPEN_SUPPRESS_MS = 220;
const DRAFT_SELECTION_HIGHLIGHT_NAME = "annota-draft-selection";
const DRAWER_ROOT_CLASS = "annota-drawer-root";
const DRAWER_RAIL_CLASS = "annota-drawer-rail";
const DRAWER_DOCK_CLASS = "annota-drawer-dock";
const DRAWER_HANDLE_CLASS = "annota-drawer-item";
const DRAWER_ICON_CLASS = "annota-drawer-item-icon";
const DRAWER_PANEL_CLASS = "annota-drawer-panel";
const DRAWER_IFRAME_CLASS = "annota-drawer-iframe";

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

type ActiveEditColorPreview = {
  annotationID: string;
  originalColor: string;
};

type ToolbarAnchor = {
  preferredRect: DOMRect;
  avoidRects: DOMRect[];
};

let toolbar: HTMLDivElement | null = null;
let activeDraft: SelectionDraft | null = null;
let activeEditColorPreview: ActiveEditColorPreview | null = null;
let activeMarkdownEditor: MarkdownEditorWidget | null = null;
let latestAnnotations: Annotation[] = [];
let renderRetryTimers: number[] = [];
let mutationObserver: MutationObserver | null = null;
let mutationObserverStopTimer: number | null = null;
let mutationRenderTimer: number | null = null;
let storageRefreshTimer: number | null = null;
let suppressToolbarOpenUntil = 0;
let toolbarRepositionObserver: ResizeObserver | null = null;
let toolbarRepositionFrameID: number | null = null;
let toolbarRepositionAnchor: ToolbarAnchor | null = null;
let activeDraftSelectionRange: Range | null = null;
let dialogDefaultEnabled = true;
let dialogSiteEnabledMap: Record<string, boolean> = {};
let dialogEnabled = true;
let drawerRoot: HTMLDivElement | null = null;
let drawerRail: HTMLDivElement | null = null;
let drawerHandle: HTMLButtonElement | null = null;
let drawerOpen = false;
let toolbarPreferences: ToolbarPreferences = {
  opacity: 0.92,
  width: 320
};

const currentURL = (): string => window.location.href;
const pageTitle = (): string => document.title;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const isDialogEnabled = (): boolean => dialogEnabled;

const parseDialogSiteScope = (value: string): string | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};

const normalizeDialogSiteMap = (value: unknown): Record<string, boolean> => {
  if (!value || typeof value !== "object") {
    return {};
  }
  const source = value as Record<string, unknown>;
  const next: Record<string, boolean> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (key.trim() && typeof raw === "boolean") {
      next[key] = raw;
    }
  }
  return next;
};

const resolveDialogEnabledForURL = (url: string): boolean => {
  const scope = parseDialogSiteScope(url);
  if (scope && Object.prototype.hasOwnProperty.call(dialogSiteEnabledMap, scope)) {
    return dialogSiteEnabledMap[scope];
  }
  return dialogDefaultEnabled;
};

const parseHexColor = (input: string): { r: number; g: number; b: number } | null => {
  const value = input.trim().toLowerCase();
  if (!value.startsWith("#")) {
    return null;
  }

  const hex = value.slice(1);
  if (hex.length === 3) {
    const r = parseInt(`${hex[0]}${hex[0]}`, 16);
    const g = parseInt(`${hex[1]}${hex[1]}`, 16);
    const b = parseInt(`${hex[2]}${hex[2]}`, 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      return null;
    }
    return { r, g, b };
  }

  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      return null;
    }
    return { r, g, b };
  }

  return null;
};

const toLinearChannel = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const pickReadableTextColor = (backgroundColor: string): string => {
  const background = parseHexColor(backgroundColor);
  if (!background) {
    return "#0f172a";
  }

  const luminance = (rgb: { r: number; g: number; b: number }): number =>
    0.2126 * toLinearChannel(rgb.r) + 0.7152 * toLinearChannel(rgb.g) + 0.0722 * toLinearChannel(rgb.b);

  const contrastRatio = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number => {
    const lumA = luminance(a);
    const lumB = luminance(b);
    const lighter = Math.max(lumA, lumB);
    const darker = Math.min(lumA, lumB);
    return (lighter + 0.05) / (darker + 0.05);
  };

  const darkText = { r: 15, g: 23, b: 42 };
  const lightText = { r: 248, g: 250, b: 252 };
  return contrastRatio(background, darkText) >= contrastRatio(background, lightText) ? "#0f172a" : "#f8fafc";
};

const applyHighlightColorToAnnotation = (annotationID: string, color: string): void => {
  const escaped = escapeForAttributeSelector(annotationID);
  const textColor = pickReadableTextColor(color);
  document.querySelectorAll<HTMLElement>(`[data-anno-id="${escaped}"]`).forEach((element) => {
    element.style.setProperty("--annota-highlight-color", color);
    element.style.setProperty("--annota-highlight-text-color", textColor);
  });
};

type CSSHighlightsRegistryLike = {
  set: (name: string, value: unknown) => void;
  delete: (name: string) => void;
};

const getCSSHighlightsRegistry = (): CSSHighlightsRegistryLike | null => {
  if (typeof CSS === "undefined") {
    return null;
  }
  const maybe = (CSS as { highlights?: CSSHighlightsRegistryLike }).highlights;
  if (!maybe || typeof maybe.set !== "function" || typeof maybe.delete !== "function") {
    return null;
  }
  return maybe;
};

const applyDraftSelectionPreview = (range: Range, color: string): void => {
  const registry = getCSSHighlightsRegistry();
  const HighlightCtor = (window as unknown as { Highlight?: new (range: Range) => unknown }).Highlight;
  if (!registry || typeof HighlightCtor !== "function") {
    activeDraftSelectionRange = null;
    return;
  }
  activeDraftSelectionRange = range.cloneRange();
  try {
    registry.set(DRAFT_SELECTION_HIGHLIGHT_NAME, new HighlightCtor(activeDraftSelectionRange));
    document.documentElement.style.setProperty("--annota-draft-preview-color", color);
  } catch {
    activeDraftSelectionRange = null;
  }
};

const updateDraftSelectionPreviewColor = (color: string): void => {
  if (!activeDraftSelectionRange) {
    return;
  }
  const registry = getCSSHighlightsRegistry();
  const HighlightCtor = (window as unknown as { Highlight?: new (range: Range) => unknown }).Highlight;
  if (!registry || typeof HighlightCtor !== "function") {
    return;
  }
  try {
    registry.set(DRAFT_SELECTION_HIGHLIGHT_NAME, new HighlightCtor(activeDraftSelectionRange));
    document.documentElement.style.setProperty("--annota-draft-preview-color", color);
  } catch {
    // ignore update failure and keep interaction flowing
  }
};

const clearDraftSelectionPreview = (): void => {
  activeDraftSelectionRange = null;
  const registry = getCSSHighlightsRegistry();
  registry?.delete(DRAFT_SELECTION_HIGHLIGHT_NAME);
  document.documentElement.style.removeProperty("--annota-draft-preview-color");
};

const revertActiveEditColorPreview = (): void => {
  if (!activeEditColorPreview) {
    return;
  }
  applyHighlightColorToAnnotation(activeEditColorPreview.annotationID, activeEditColorPreview.originalColor);
  activeEditColorPreview = null;
};

const hideToolbar = (options?: { revertEditColorPreview?: boolean }): void => {
  if (toolbarRepositionFrameID !== null) {
    window.cancelAnimationFrame(toolbarRepositionFrameID);
    toolbarRepositionFrameID = null;
  }
  toolbarRepositionObserver?.disconnect();
  toolbarRepositionObserver = null;
  toolbarRepositionAnchor = null;
  window.removeEventListener("scroll", scheduleToolbarReposition, true);
  window.removeEventListener("resize", scheduleToolbarReposition, true);
  clearDraftSelectionPreview();
  activeMarkdownEditor?.destroy();
  activeMarkdownEditor = null;
  if (options?.revertEditColorPreview ?? true) {
    revertActiveEditColorPreview();
  } else {
    activeEditColorPreview = null;
  }
  toolbar?.remove();
  toolbar = null;
  activeDraft = null;
};

const closeToolbarByUserIntent = (options?: { clearSelection?: boolean }): void => {
  suppressToolbarOpenUntil = Date.now() + TOOLBAR_REOPEN_SUPPRESS_MS;
  if (options?.clearSelection ?? true) {
    window.getSelection()?.removeAllRanges();
  }
  hideToolbar();
};

const applyToolbarPreferences = (element: HTMLDivElement): void => {
  element.style.setProperty("--annota-toolbar-opacity", toolbarPreferences.opacity.toFixed(2));
  element.style.setProperty("--annota-toolbar-width", `${Math.round(toolbarPreferences.width)}px`);
};

const loadToolbarPreferences = async (): Promise<void> => {
  const data = await chrome.storage.sync.get([
    SETTINGS_KEY_TOOLBAR_OPACITY,
    SETTINGS_KEY_TOOLBAR_WIDTH,
    SETTINGS_KEY_DIALOG_DEFAULT_ENABLED,
    SETTINGS_KEY_DIALOG_SITE_MAP,
    SETTINGS_KEY_DIALOG_LEGACY_ENABLED
  ]);
  const opacityValue = data[SETTINGS_KEY_TOOLBAR_OPACITY];
  const widthValue = data[SETTINGS_KEY_TOOLBAR_WIDTH];
  const dialogDefaultEnabledValue = data[SETTINGS_KEY_DIALOG_DEFAULT_ENABLED];
  const dialogLegacyEnabledValue = data[SETTINGS_KEY_DIALOG_LEGACY_ENABLED];
  const dialogSiteMapValue = data[SETTINGS_KEY_DIALOG_SITE_MAP];

  if (typeof opacityValue === "number") {
    toolbarPreferences.opacity = clamp(opacityValue, TOOLBAR_OPACITY_MIN, TOOLBAR_OPACITY_MAX);
  }
  if (typeof widthValue === "number") {
    toolbarPreferences.width = clamp(widthValue, TOOLBAR_WIDTH_MIN, TOOLBAR_WIDTH_MAX);
  }
  dialogDefaultEnabled =
    typeof dialogDefaultEnabledValue === "boolean"
      ? dialogDefaultEnabledValue
      : typeof dialogLegacyEnabledValue === "boolean"
        ? dialogLegacyEnabledValue
        : true;
  dialogSiteEnabledMap = normalizeDialogSiteMap(dialogSiteMapValue);
  dialogEnabled = resolveDialogEnabledForURL(currentURL());
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

  const dialogDefaultEnabledChange = changes[SETTINGS_KEY_DIALOG_DEFAULT_ENABLED];
  if (dialogDefaultEnabledChange) {
    dialogDefaultEnabled =
      typeof dialogDefaultEnabledChange.newValue === "boolean" ? dialogDefaultEnabledChange.newValue : true;
  }

  const dialogLegacyEnabledChange = changes[SETTINGS_KEY_DIALOG_LEGACY_ENABLED];
  if (dialogLegacyEnabledChange && !dialogDefaultEnabledChange) {
    if (typeof dialogLegacyEnabledChange.newValue === "boolean") {
      dialogDefaultEnabled = dialogLegacyEnabledChange.newValue;
    }
  }

  const dialogSiteMapChange = changes[SETTINGS_KEY_DIALOG_SITE_MAP];
  if (dialogSiteMapChange) {
    dialogSiteEnabledMap = normalizeDialogSiteMap(dialogSiteMapChange.newValue);
  }

  if (dialogDefaultEnabledChange || dialogLegacyEnabledChange || dialogSiteMapChange) {
    applyDialogEnabledState(resolveDialogEnabledForURL(currentURL()));
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

const clearRenderedAnnotations = (): void => {
  latestAnnotations = [];
  stopMutationObserver();
  clearRenderRetryTimers();
  clearHighlights();
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

const setDrawerVisible = (visible: boolean): void => {
  if (!drawerRoot) {
    return;
  }
  drawerRoot.dataset.enabled = visible ? "true" : "false";
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
  if (!dialogEnabled) {
    clearRenderedAnnotations();
    return { renderedCount: 0, totalCount: 0 };
  }

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

const applyDialogEnabledState = (enabled: boolean): void => {
  dialogEnabled = enabled;
  setDrawerVisible(enabled);
  if (!enabled) {
    setDrawerOpen(false);
    hideToolbar();
    clearRenderedAnnotations();
    return;
  }
  void refreshAnnotations().catch(() => {
    // Ignore refresh errors when toggling dialog mode; next sync/change can recover.
  });
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

  hideToolbar({ revertEditColorPreview: false });
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
  toolbarElement: HTMLDivElement,
  avoidRects: DOMRect[] = [rect]
): { top: number; left: number } => {
  const width = toolbarElement.offsetWidth;
  const height = toolbarElement.offsetHeight;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  const minLeft = scrollX + VIEWPORT_MARGIN;
  const maxLeft = scrollX + window.innerWidth - width - VIEWPORT_MARGIN;
  const minTop = scrollY + VIEWPORT_MARGIN;
  const maxTop = scrollY + window.innerHeight - height - VIEWPORT_MARGIN;
  const aboveTop = scrollY + rect.top - height - TOOLBAR_GAP;
  const belowTop = scrollY + rect.bottom + TOOLBAR_GAP;
  const clampLeft = (value: number): number => Math.min(Math.max(value, minLeft), Math.max(minLeft, maxLeft));
  const clampTop = (value: number): number => Math.min(Math.max(value, minTop), Math.max(minTop, maxTop));

  const normalizedAvoidRects = (avoidRects.length > 0 ? avoidRects : [rect]).map((item) => ({
    left: scrollX + item.left - TOOLBAR_GAP,
    top: scrollY + item.top - TOOLBAR_GAP,
    right: scrollX + item.right + TOOLBAR_GAP,
    bottom: scrollY + item.bottom + TOOLBAR_GAP
  }));

  const intersects = (top: number, left: number): boolean => {
    const right = left + width;
    const bottom = top + height;
    for (const avoidRect of normalizedAvoidRects) {
      if (right <= avoidRect.left) {
        continue;
      }
      if (left >= avoidRect.right) {
        continue;
      }
      if (bottom <= avoidRect.top) {
        continue;
      }
      if (top >= avoidRect.bottom) {
        continue;
      }
      return true;
    }
    return false;
  };

  const overlapArea = (top: number, left: number): number => {
    let area = 0;
    for (const avoidRect of normalizedAvoidRects) {
      const overlapLeft = Math.max(left, avoidRect.left);
      const overlapTop = Math.max(top, avoidRect.top);
      const overlapRight = Math.min(left + width, avoidRect.right);
      const overlapBottom = Math.min(top + height, avoidRect.bottom);
      if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) {
        continue;
      }
      area += (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
    }
    return area;
  };

  const centerLeft = scrollX + rect.left + rect.width / 2 - width / 2;
  const alignLeft = scrollX + rect.left;
  const alignRight = scrollX + rect.right - width;
  const leftCandidates = [centerLeft, alignLeft, alignRight].map(clampLeft);

  const spaceAbove = rect.top - VIEWPORT_MARGIN;
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
  const verticalCandidates = spaceBelow >= spaceAbove ? [belowTop, aboveTop] : [aboveTop, belowTop];

  const candidates: Array<{ top: number; left: number }> = [];
  for (const topCandidate of verticalCandidates) {
    const top = clampTop(topCandidate);
    for (const leftCandidate of leftCandidates) {
      const key = `${Math.round(top)}:${Math.round(leftCandidate)}`;
      if (!candidates.some((item) => `${Math.round(item.top)}:${Math.round(item.left)}` === key)) {
        candidates.push({ top, left: leftCandidate });
      }
    }
  }

  for (const candidate of candidates) {
    if (!intersects(candidate.top, candidate.left)) {
      return candidate;
    }
  }

  let bestCandidate = candidates[0] ?? { top: clampTop(belowTop), left: clampLeft(centerLeft) };
  let bestOverlap = overlapArea(bestCandidate.top, bestCandidate.left);
  for (const candidate of candidates.slice(1)) {
    const area = overlapArea(candidate.top, candidate.left);
    if (area < bestOverlap) {
      bestCandidate = candidate;
      bestOverlap = area;
    }
  }
  return bestCandidate;
};

function scheduleToolbarReposition(): void {
  if (!toolbar || !toolbarRepositionAnchor) {
    return;
  }
  if (toolbarRepositionFrameID !== null) {
    window.cancelAnimationFrame(toolbarRepositionFrameID);
  }
  toolbarRepositionFrameID = window.requestAnimationFrame(() => {
    toolbarRepositionFrameID = null;
    if (!toolbar || !toolbarRepositionAnchor) {
      return;
    }
    const { top, left } = computeToolbarPosition(
      toolbarRepositionAnchor.preferredRect,
      toolbar,
      toolbarRepositionAnchor.avoidRects
    );
    toolbar.style.top = `${top}px`;
    toolbar.style.left = `${left}px`;
  });
}

const setupToolbarAutoReposition = (
  toolbarElement: HTMLDivElement,
  preferredRect: DOMRect,
  avoidRects: DOMRect[] = [preferredRect]
): void => {
  const cloneRect = (source: DOMRect): DOMRect => new DOMRect(source.x, source.y, source.width, source.height);
  toolbarRepositionAnchor = {
    preferredRect: cloneRect(preferredRect),
    avoidRects: avoidRects.length > 0 ? avoidRects.map(cloneRect) : [cloneRect(preferredRect)]
  };
  toolbarRepositionObserver?.disconnect();
  toolbarRepositionObserver = null;
  window.removeEventListener("scroll", scheduleToolbarReposition, true);
  window.removeEventListener("resize", scheduleToolbarReposition, true);
  if (typeof ResizeObserver === "function") {
    toolbarRepositionObserver = new ResizeObserver(() => {
      scheduleToolbarReposition();
    });
    toolbarRepositionObserver.observe(toolbarElement);
  }
  window.addEventListener("scroll", scheduleToolbarReposition, true);
  window.addEventListener("resize", scheduleToolbarReposition, true);
  scheduleToolbarReposition();
  window.setTimeout(scheduleToolbarReposition, 0);
  window.setTimeout(scheduleToolbarReposition, 80);
};

const setDrawerOpen = (next: boolean): void => {
  drawerOpen = next;
  if (!drawerRail || !drawerHandle) {
    return;
  }
  drawerRail.dataset.open = next ? "true" : "false";
  drawerHandle.dataset.active = next ? "true" : "false";
  drawerHandle.setAttribute("aria-pressed", next ? "true" : "false");
};

const ensureDrawerUI = (): void => {
  if (drawerRoot) {
    return;
  }
  if (!document.body) {
    return;
  }

  const root = document.createElement("div");
  root.className = DRAWER_ROOT_CLASS;
  root.dataset.enabled = dialogEnabled ? "true" : "false";

  const rail = document.createElement("div");
  rail.className = DRAWER_RAIL_CLASS;

  const dock = document.createElement("div");
  dock.className = DRAWER_DOCK_CLASS;

  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = DRAWER_HANDLE_CLASS;
  handle.setAttribute("aria-label", "打开或关闭 Annota 侧边栏");
  handle.title = "Annota";
  handle.setAttribute("aria-pressed", "false");

  const icon = document.createElement("span");
  icon.className = DRAWER_ICON_CLASS;
  icon.textContent = "A";
  icon.setAttribute("aria-hidden", "true");
  handle.appendChild(icon);

  const panel = document.createElement("div");
  panel.className = DRAWER_PANEL_CLASS;

  const iframe = document.createElement("iframe");
  iframe.className = DRAWER_IFRAME_CLASS;
  iframe.src = chrome.runtime.getURL("src/sidepanel/index.html");
  iframe.loading = "lazy";
  iframe.title = "Annota 抽拉面板";

  panel.appendChild(iframe);
  dock.appendChild(handle);
  rail.append(dock, panel);
  root.appendChild(rail);
  document.body.appendChild(root);

  handle.addEventListener("click", (event) => {
    event.preventDefault();
    setDrawerOpen(!drawerOpen);
  });

  drawerRoot = root;
  drawerRail = rail;
  drawerHandle = handle;
  setDrawerOpen(false);
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
  if (!isDialogEnabled()) {
    hideToolbar();
    return;
  }
  hideToolbar();

  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return;
  }
  const clientRects = Array.from(range.getClientRects()).filter((item) => item.width > 0 && item.height > 0);
  const avoidRects = clientRects.length > 0 ? clientRects : [rect];
  const preferredRect = avoidRects[avoidRects.length - 1] ?? rect;

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
    updateDraftSelectionPreviewColor(color);
  });
  applyDraftSelectionPreview(range, selectedColor);

  const commentEditor = createMarkdownEditorWidget({
    placeholder: "可选：输入评论（支持 Markdown）",
    rows: 4
  });
  activeMarkdownEditor = commentEditor;

  const errorText = document.createElement("div");
  errorText.className = "annota-toolbar-error";
  errorText.hidden = true;

  const setError = (message: string): void => {
    errorText.textContent = message;
    errorText.hidden = message.trim() === "";
  };

  const actionRow = document.createElement("div");
  actionRow.className = "annota-action-row";

  const handleCancel = async (): Promise<void> => {
    closeToolbarByUserIntent();
  };
  const cancelButton = buildActionButton("取消", "ghost", handleCancel);

  const handleHighlightOnly = async (): Promise<boolean> => {
    setError("");
    highlightOnlyButton.disabled = true;
    saveCommentButton.disabled = true;
    const previousText = highlightOnlyButton.textContent;
    highlightOnlyButton.textContent = "保存中...";
    try {
      await createAnnotation(activeDraft, { color: selectedColor, commentText: "" });
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存高亮失败");
      return false;
    } finally {
      highlightOnlyButton.disabled = false;
      saveCommentButton.disabled = false;
      highlightOnlyButton.textContent = previousText;
    }
  };
  const highlightOnlyButton = buildActionButton("仅高亮", "ghost", async () => {
    await handleHighlightOnly();
  });

  const handleSaveComment = async (): Promise<boolean> => {
    const comment = commentEditor.getValue().trim();
    if (!comment) {
      setError("评论不能为空");
      commentEditor.focus();
      return false;
    }

    setError("");
    highlightOnlyButton.disabled = true;
    saveCommentButton.disabled = true;
    const previousText = saveCommentButton.textContent;
    saveCommentButton.textContent = "保存中...";
    try {
      await createAnnotation(activeDraft, { color: selectedColor, commentText: comment });
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存评论失败");
      return false;
    } finally {
      highlightOnlyButton.disabled = false;
      saveCommentButton.disabled = false;
      saveCommentButton.textContent = previousText;
    }
  };
  const saveCommentButton = buildActionButton("保存评论", "primary", async () => {
    await handleSaveComment();
  });

  commentEditor.onInput((value) => {
    if (errorText.hidden) {
      return;
    }
    if (value.trim()) {
      setError("");
    }
  });

  commentEditor.onKeyDown((event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void saveCommentButton.click();
    }
  });
  commentEditor.setOnCancelRequest(() => {
    void handleCancel();
  });
  commentEditor.setOnSaveRequest(() => {
    void handleSaveComment();
  });

  actionRow.append(cancelButton, highlightOnlyButton, saveCommentButton);
  nextToolbar.append(heading, colorRow, commentEditor.container, errorText, actionRow);
  document.body.appendChild(nextToolbar);
  toolbar = nextToolbar;
  setupToolbarAutoReposition(nextToolbar, preferredRect, avoidRects);
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
  activeEditColorPreview = {
    annotationID: annotation.id,
    originalColor: annotation.color
  };

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
    applyHighlightColorToAnnotation(annotation.id, color);
    quotePreview.style.setProperty("--annota-highlight-color", color);
  });

  const commentEditor = createMarkdownEditorWidget({
    placeholder: "请输入评论（支持 Markdown，可为空）",
    rows: 5,
    initialValue: annotation.commentText ?? ""
  });
  activeMarkdownEditor = commentEditor;

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

  const handleCancel = async (): Promise<void> => {
    if (saving) {
      return;
    }
    closeToolbarByUserIntent();
  };
  const cancelButton = buildActionButton("取消", "ghost", handleCancel);

  const handleSaveComment = async (): Promise<boolean> => {
    if (saving) {
      return false;
    }
    saving = true;
    setError("");
    cancelButton.disabled = true;
    saveButton.disabled = true;
    const previous = saveButton.textContent;
      saveButton.textContent = "保存中...";
    try {
      await updateAnnotationComment(annotation.id, commentEditor.getValue(), selectedColor);
      commentEditor.markSaved();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存评论失败");
      return false;
    } finally {
      saving = false;
      cancelButton.disabled = false;
      saveButton.disabled = false;
      saveButton.textContent = previous;
    }
  };
  const saveButton = buildActionButton("保存评论", "primary", async () => {
    await handleSaveComment();
  });

  commentEditor.onKeyDown((event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void saveButton.click();
    }
  });
  commentEditor.setOnCancelRequest(() => {
    void handleCancel();
  });
  commentEditor.setOnSaveRequest(() => {
    void handleSaveComment();
  });

  actionRow.append(cancelButton, saveButton);
  nextToolbar.append(heading, subtitle, colorRow, quotePreview, commentEditor.container, errorText, actionRow);
  document.body.appendChild(nextToolbar);
  toolbar = nextToolbar;
  setupToolbarAutoReposition(nextToolbar, anchorRect, [anchorRect]);
  window.setTimeout(() => {
    commentEditor.focus();
  }, 0);
};

const openEditCommentForAnnotation = async (annotationID: string): Promise<void> => {
  if (!isDialogEnabled()) {
    hideToolbar();
    return;
  }
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
  if (target?.closest(".annota-fullscreen-overlay")) {
    return;
  }
  if (toolbar && target && target.closest(`.${TOOLBAR_CLASS}`)) {
    return;
  }

  if (!isDialogEnabled()) {
    if (toolbar) {
      hideToolbar();
    }
    return;
  }

  const range = getCurrentSelectionRange();
  if (!range) {
    const annotationID = target?.closest<HTMLElement>(".annota-highlight")?.dataset.annoId?.trim() ?? "";
    if (annotationID) {
      void openEditCommentForAnnotation(annotationID);
      return;
    }
    if (toolbar) {
      closeToolbarByUserIntent({ clearSelection: false });
    }
    return;
  }

  if (Date.now() < suppressToolbarOpenUntil) {
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
    if (!isDialogEnabled()) {
      return;
    }
    void openEditCommentForAnnotation(message.payload.id);
  }
};

const bootstrap = async (): Promise<void> => {
  document.addEventListener("mouseup", selectionHandler);
  chrome.runtime.onMessage.addListener((message) => {
    onRuntimeMessage(message as RuntimeRequest | AnnotationChangedEvent);
  });
  chrome.storage.onChanged.addListener(onExtensionStorageChanged);

  await loadToolbarPreferences();
  ensureDrawerUI();
  applyDialogEnabledState(dialogEnabled);
};

void bootstrap();
