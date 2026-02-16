import type { Annotation } from "@/shared/annotation";

const HIGHLIGHT_CLASS = "annota-highlight";

interface TextBoundary {
  node: Text;
  offset: number;
}

interface TextNodeEntry {
  node: Text;
  text: string;
  start: number;
  end: number;
}

interface TextSnapshot {
  entries: TextNodeEntry[];
  fullText: string;
}

interface RGBColor {
  r: number;
  g: number;
  b: number;
}

type QuoteContext = {
  prefixText: string;
  suffixText: string;
};

const shouldSkipNode = (node: Text, options?: { excludeHighlights?: boolean }): boolean => {
  const parent = node.parentElement;
  if (!parent) {
    return true;
  }
  if (options?.excludeHighlights && parent.closest(`.${HIGHLIGHT_CLASS}`)) {
    return true;
  }

  const tagName = parent.tagName.toLowerCase();
  return ["script", "style", "noscript", "textarea"].includes(tagName);
};

const walkTextNodes = (root: Node, options?: { excludeHighlights?: boolean }): Text[] => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];

  while (walker.nextNode()) {
    const current = walker.currentNode as Text;
    if (current.textContent && current.textContent.length > 0 && !shouldSkipNode(current, options)) {
      nodes.push(current);
    }
  }

  return nodes;
};

const buildTextSnapshot = (options?: { excludeHighlights?: boolean }): TextSnapshot => {
  const textNodes = walkTextNodes(document.body, options);
  const entries: TextNodeEntry[] = [];
  let cursor = 0;
  let fullText = "";

  for (const node of textNodes) {
    const text = node.textContent ?? "";
    if (text.length === 0) {
      continue;
    }

    const start = cursor;
    cursor += text.length;
    entries.push({ node, text, start, end: cursor });
    fullText += text;
  }

  return { entries, fullText };
};

export const extractPosition = (range: Range): { startOffset: number; endOffset: number } | null => {
  // Offsets must be based on full page text. Excluding already-highlighted text
  // would shift all later annotations on the same page.
  const snapshot = buildTextSnapshot({ excludeHighlights: false });
  let startOffset = -1;
  let endOffset = -1;

  for (const entry of snapshot.entries) {
    const textNode = entry.node;
    const textLength = entry.text.length;
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
          startOffset = entry.start + startInNode;
        }
        endOffset = entry.start + endInNode;
      }
    }
  }

  if (startOffset < 0 || endOffset < 0 || endOffset <= startOffset) {
    return null;
  }

  return { startOffset, endOffset };
};

const locateTextBoundary = (
  snapshot: TextSnapshot,
  offset: number,
  options?: { preferNextAtBoundary?: boolean }
): TextBoundary | null => {
  if (snapshot.entries.length === 0) {
    return null;
  }

  const fullLength = snapshot.fullText.length;
  const clampedOffset = Math.max(0, Math.min(offset, fullLength));

  for (let i = 0; i < snapshot.entries.length; i += 1) {
    const entry = snapshot.entries[i];
    if (clampedOffset < entry.end) {
      return {
        node: entry.node,
        offset: clampedOffset - entry.start
      };
    }

    if (clampedOffset === entry.end) {
      if (options?.preferNextAtBoundary) {
        const nextEntry = snapshot.entries[i + 1];
        if (nextEntry) {
          return {
            node: nextEntry.node,
            offset: 0
          };
        }
      }
      return {
        node: entry.node,
        offset: entry.text.length
      };
    }
  }

  const lastEntry = snapshot.entries[snapshot.entries.length - 1];
  return {
    node: lastEntry.node,
    offset: lastEntry.text.length
  };
};

const createRangeByOffsets = (snapshot: TextSnapshot, startOffset: number, endOffset: number): Range | null => {
  if (endOffset <= startOffset) {
    return null;
  }

  const startBoundary = locateTextBoundary(snapshot, startOffset, { preferNextAtBoundary: true });
  const endBoundary = locateTextBoundary(snapshot, endOffset, { preferNextAtBoundary: false });

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

const normalizeTextForMatch = (value: string): string => value.replace(/\s+/g, " ").trim();

const rangeMatchesQuote = (range: Range, quoteText: string): boolean => {
  const expected = normalizeTextForMatch(quoteText);
  if (!expected) {
    return true;
  }
  return normalizeTextForMatch(range.toString()) === expected;
};

const countCommonPrefixLength = (left: string, right: string): number => {
  const limit = Math.min(left.length, right.length);
  let count = 0;
  while (count < limit && left[count] === right[count]) {
    count += 1;
  }
  return count;
};

const countCommonSuffixLength = (left: string, right: string): number => {
  const leftLength = left.length;
  const rightLength = right.length;
  const limit = Math.min(leftLength, rightLength);
  let count = 0;
  while (count < limit && left[leftLength - 1 - count] === right[rightLength - 1 - count]) {
    count += 1;
  }
  return count;
};

const findOccurrences = (text: string, keyword: string, maxCandidates = 2048): number[] => {
  if (!keyword || text.length === 0 || keyword.length > text.length) {
    return [];
  }

  const indices: number[] = [];
  let fromIndex = 0;

  while (indices.length < maxCandidates) {
    const index = text.indexOf(keyword, fromIndex);
    if (index < 0) {
      break;
    }
    indices.push(index);
    fromIndex = index + 1;
  }

  return indices;
};

const scoreOccurrence = (
  startOffset: number,
  endOffset: number,
  annotation: Annotation,
  fullText: string
): number => {
  let score = 0;
  const prefix = annotation.prefixText ?? "";
  const suffix = annotation.suffixText ?? "";

  if (prefix.length > 0) {
    const actualPrefix = fullText.slice(Math.max(0, startOffset - prefix.length), startOffset);
    const matchedPrefix = countCommonSuffixLength(actualPrefix, prefix);
    score += matchedPrefix * 3;
    if (matchedPrefix === prefix.length) {
      score += 48;
    }
  }

  if (suffix.length > 0) {
    const actualSuffix = fullText.slice(endOffset, endOffset + suffix.length);
    const matchedSuffix = countCommonPrefixLength(actualSuffix, suffix);
    score += matchedSuffix * 3;
    if (matchedSuffix === suffix.length) {
      score += 48;
    }
  }

  const distance = Math.abs(startOffset - annotation.startOffset);
  score -= distance / 120;
  return score;
};

const resolveRangeByTextAnchor = (annotation: Annotation, snapshot: TextSnapshot): Range | null => {
  const quote = annotation.quoteText ?? "";
  if (!quote) {
    return null;
  }

  const matches = findOccurrences(snapshot.fullText, quote);
  if (matches.length === 0) {
    return null;
  }

  let bestStart = matches[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const start of matches) {
    const end = start + quote.length;
    const score = scoreOccurrence(start, end, annotation, snapshot.fullText);
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }

  const resolvedRange = createRangeByOffsets(snapshot, bestStart, bestStart + quote.length);
  if (!resolvedRange || !rangeMatchesQuote(resolvedRange, quote)) {
    return null;
  }
  return resolvedRange;
};

const resolveAnnotationRange = (annotation: Annotation, snapshot: TextSnapshot): Range | null => {
  const offsetRange = createRangeByOffsets(snapshot, annotation.startOffset, annotation.endOffset);
  if (offsetRange && rangeMatchesQuote(offsetRange, annotation.quoteText)) {
    return offsetRange;
  }
  return resolveRangeByTextAnchor(annotation, snapshot);
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
    if (shouldSkipNode(node, { excludeHighlights: true })) {
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
  const snapshot = buildTextSnapshot({ excludeHighlights: false });

  for (const annotation of annotations) {
    const range = resolveAnnotationRange(annotation, snapshot);
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

export const getQuoteContextByOffsets = (
  startOffset: number,
  endOffset: number,
  contextLength = 32
): QuoteContext => {
  const fullText = buildTextSnapshot({ excludeHighlights: false }).fullText;
  if (startOffset < 0 || endOffset < startOffset || startOffset > fullText.length) {
    return { prefixText: "", suffixText: "" };
  }

  const clampedEnd = Math.max(startOffset, Math.min(endOffset, fullText.length));
  const prefixStart = Math.max(0, startOffset - contextLength);
  const suffixEnd = Math.min(fullText.length, clampedEnd + contextLength);

  return {
    prefixText: fullText.slice(prefixStart, startOffset),
    suffixText: fullText.slice(clampedEnd, suffixEnd)
  };
};
