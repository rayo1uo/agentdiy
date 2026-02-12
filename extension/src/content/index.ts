import { DEFAULT_HIGHLIGHT_COLOR, type Annotation, type AnnotationCreateInput } from "@/shared/annotation";
import type { AnnotationChangedEvent, AnnotationListResponse, RuntimeRequest } from "@/shared/messages";
import { sendRuntimeMessage } from "@/lib/runtime";
import { extractPosition, focusAnnotation, renderAnnotations } from "./highlight";

const TOOLBAR_CLASS = "annota-toolbar";

let toolbar: HTMLDivElement | null = null;

const currentURL = (): string => window.location.href;
const pageTitle = (): string => document.title;

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

const refreshAnnotations = async (): Promise<void> => {
  const result = await sendRuntimeMessage<AnnotationListResponse>({
    type: "annotation.list",
    payload: { url: currentURL() }
  });

  renderAnnotations(result.annotations);
};

const createAnnotation = async (commentText: string): Promise<void> => {
  const range = getCurrentSelectionRange();
  if (!range) {
    hideToolbar();
    return;
  }

  const selectedText = range.toString().trim();
  const position = extractPosition(range);
  if (!position) {
    console.warn("Selection cannot be serialized yet. Please select plain text.");
    hideToolbar();
    return;
  }

  const { prefixText, suffixText } = getQuoteContext(selectedText);
  const payload: AnnotationCreateInput = {
    url: currentURL(),
    title: pageTitle(),
    quoteText: selectedText,
    prefixText,
    suffixText,
    startOffset: position.startOffset,
    endOffset: position.endOffset,
    color: DEFAULT_HIGHLIGHT_COLOR,
    commentText
  };

  await sendRuntimeMessage<Annotation>({
    type: "annotation.create",
    payload
  });

  hideToolbar();
  window.getSelection()?.removeAllRanges();
  await refreshAnnotations();
};

const buildToolbarButton = (
  label: string,
  kind: "highlight" | "comment",
  onClick: () => Promise<void>
): HTMLButtonElement => {
  const button = document.createElement("button");
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

const showToolbar = (range: Range): void => {
  hideToolbar();

  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return;
  }

  const nextToolbar = document.createElement("div");
  nextToolbar.className = TOOLBAR_CLASS;

  const highlightButton = buildToolbarButton("高亮", "highlight", async () => {
    await createAnnotation("");
  });

  const commentButton = buildToolbarButton("评论", "comment", async () => {
    const comment = window.prompt("输入评论内容", "") ?? "";
    await createAnnotation(comment.trim());
  });

  nextToolbar.append(highlightButton, commentButton);
  document.body.appendChild(nextToolbar);

  const top = window.scrollY + rect.top - nextToolbar.offsetHeight - 8;
  const left = window.scrollX + rect.left;

  nextToolbar.style.top = `${Math.max(8, top)}px`;
  nextToolbar.style.left = `${Math.max(8, left)}px`;

  toolbar = nextToolbar;
};

const selectionHandler = (): void => {
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
    focusAnnotation(message.payload.id);
  }
};

const bootstrap = async (): Promise<void> => {
  document.addEventListener("mouseup", selectionHandler);
  document.addEventListener("keyup", selectionHandler);
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

  await refreshAnnotations();
};

void bootstrap();
