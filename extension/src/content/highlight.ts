import type { Annotation } from "@/shared/annotation";

const HIGHLIGHT_CLASS = "annota-highlight";

interface TextBoundary {
  node: Text;
  offset: number;
}

const shouldSkipNode = (node: Text): boolean => {
  const parent = node.parentElement;
  if (!parent) {
    return true;
  }
  if (parent.closest(`.${HIGHLIGHT_CLASS}`)) {
    return true;
  }

  const tagName = parent.tagName.toLowerCase();
  return ["script", "style", "noscript", "textarea"].includes(tagName);
};

const walkTextNodes = (root: Node): Text[] => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];

  while (walker.nextNode()) {
    const current = walker.currentNode as Text;
    if (current.textContent && current.textContent.length > 0 && !shouldSkipNode(current)) {
      nodes.push(current);
    }
  }

  return nodes;
};

export const extractPosition = (range: Range): { startOffset: number; endOffset: number } | null => {
  if (range.startContainer.nodeType !== Node.TEXT_NODE || range.endContainer.nodeType !== Node.TEXT_NODE) {
    return null;
  }

  const textNodes = walkTextNodes(document.body);
  let cursor = 0;
  let startOffset = -1;
  let endOffset = -1;

  for (const textNode of textNodes) {
    if (textNode === range.startContainer) {
      startOffset = cursor + range.startOffset;
    }

    if (textNode === range.endContainer) {
      endOffset = cursor + range.endOffset;
      break;
    }

    cursor += textNode.textContent?.length ?? 0;
  }

  if (startOffset < 0 || endOffset < 0 || endOffset <= startOffset) {
    return null;
  }

  return { startOffset, endOffset };
};

const locateTextBoundary = (offset: number): TextBoundary | null => {
  const textNodes = walkTextNodes(document.body);
  let cursor = 0;

  for (const textNode of textNodes) {
    const textLength = textNode.textContent?.length ?? 0;
    const nextCursor = cursor + textLength;

    if (offset <= nextCursor) {
      return {
        node: textNode,
        offset: Math.max(0, Math.min(offset - cursor, textLength))
      };
    }

    cursor = nextCursor;
  }

  return null;
};

const createRangeByOffsets = (startOffset: number, endOffset: number): Range | null => {
  const startBoundary = locateTextBoundary(startOffset);
  const endBoundary = locateTextBoundary(endOffset);

  if (!startBoundary || !endBoundary) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);
  if (range.collapsed) {
    return null;
  }

  return range;
};

const wrapRange = (range: Range, annotation: Annotation): boolean => {
  try {
    const wrapper = document.createElement("span");
    wrapper.className = HIGHLIGHT_CLASS;
    wrapper.dataset.annoId = annotation.id;
    wrapper.style.backgroundColor = annotation.color;

    const extracted = range.extractContents();
    wrapper.appendChild(extracted);
    range.insertNode(wrapper);
    return true;
  } catch {
    return false;
  }
};

export const clearHighlights = (): void => {
  const highlights = document.querySelectorAll<HTMLSpanElement>(`.${HIGHLIGHT_CLASS}`);
  highlights.forEach((highlight) => {
    const parent = highlight.parentNode;
    if (!parent) {
      return;
    }

    while (highlight.firstChild) {
      parent.insertBefore(highlight.firstChild, highlight);
    }
    parent.removeChild(highlight);
    parent.normalize();
  });
};

export const renderAnnotations = (annotations: Annotation[]): Annotation[] => {
  clearHighlights();
  const rendered: Annotation[] = [];

  for (const annotation of annotations) {
    const range = createRangeByOffsets(annotation.startOffset, annotation.endOffset);
    if (!range) {
      continue;
    }

    if (wrapRange(range, annotation)) {
      rendered.push(annotation);
    }
  }

  return rendered;
};

export const focusAnnotation = (annotationID: string): boolean => {
  const target = document.querySelector<HTMLElement>(`[data-anno-id="${annotationID}"]`);
  if (!target) {
    return false;
  }

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("annota-highlight-focus");
  setTimeout(() => {
    target.classList.remove("annota-highlight-focus");
  }, 1200);
  return true;
};
