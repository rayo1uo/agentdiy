import type { Annotation } from "@/shared/annotation";

const HIGHLIGHT_CLASS = "annota-highlight";

interface TextBoundary {
  node: Text;
  offset: number;
}

interface RGBColor {
  r: number;
  g: number;
  b: number;
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
  const textNodes = walkTextNodes(document.body);
  let cursor = 0;
  let startOffset = -1;
  let endOffset = -1;

  for (const textNode of textNodes) {
    const textLength = textNode.textContent?.length ?? 0;
    if (textLength === 0) {
      continue;
    }

    if (range.intersectsNode(textNode)) {
      let startInNode = 0;
      let endInNode = textLength;

      if (textNode === range.startContainer) {
        startInNode = Math.max(0, Math.min(range.startOffset, textLength));
      }
      if (textNode === range.endContainer) {
        endInNode = Math.max(0, Math.min(range.endOffset, textLength));
      }

      if (endInNode > startInNode) {
        if (startOffset < 0) {
          startOffset = cursor + startInNode;
        }
        endOffset = cursor + endInNode;
      }
    }

    cursor += textLength;
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

type RangeTextSegment = {
  node: Text;
  start: number;
  end: number;
};

const parseHexColor = (input: string): RGBColor | null => {
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

const toLinear = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const luminance = (rgb: RGBColor): number => 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);

const contrastRatio = (a: RGBColor, b: RGBColor): number => {
  const lumA = luminance(a);
  const lumB = luminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
};

const pickReadableTextColor = (backgroundColor: string): string => {
  const background = parseHexColor(backgroundColor);
  if (!background) {
    return "#0f172a";
  }

  const darkText: RGBColor = { r: 15, g: 23, b: 42 };
  const lightText: RGBColor = { r: 248, g: 250, b: 252 };
  const darkContrast = contrastRatio(background, darkText);
  const lightContrast = contrastRatio(background, lightText);
  return darkContrast >= lightContrast ? "#0f172a" : "#f8fafc";
};

const collectRangeTextSegments = (range: Range): RangeTextSegment[] => {
  const segments: RangeTextSegment[] = [];
  const appendIfValid = (node: Text): void => {
    if (shouldSkipNode(node)) {
      return;
    }
    if (!range.intersectsNode(node)) {
      return;
    }

    const textLength = node.textContent?.length ?? 0;
    if (textLength === 0) {
      return;
    }

    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : textLength;
    if (end <= start) {
      return;
    }

    const segmentText = node.textContent?.slice(start, end) ?? "";
    if (segmentText.trim() === "") {
      return;
    }

    segments.push({ node, start, end });
  };

  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) {
    appendIfValid(root as Text);
    return segments;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    appendIfValid(walker.currentNode as Text);
  }

  return segments;
};

const wrapRange = (range: Range, annotation: Annotation): boolean => {
  try {
    const segments = collectRangeTextSegments(range);
    if (segments.length === 0) {
      return false;
    }

    let wrappedCount = 0;
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const segment = segments[i];
      const subRange = document.createRange();
      subRange.setStart(segment.node, segment.start);
      subRange.setEnd(segment.node, segment.end);

      const wrapper = document.createElement("span");
      wrapper.className = HIGHLIGHT_CLASS;
      wrapper.dataset.annoId = annotation.id;
      wrapper.style.setProperty("--annota-highlight-color", annotation.color);
      wrapper.style.setProperty("--annota-highlight-text-color", pickReadableTextColor(annotation.color));

      const extracted = subRange.extractContents();
      wrapper.appendChild(extracted);
      subRange.insertNode(wrapper);
      wrappedCount += 1;
    }

    return wrappedCount > 0;
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
