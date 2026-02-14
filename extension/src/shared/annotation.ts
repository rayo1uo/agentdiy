export type AnnotationStatus = "active" | "deleted";

export interface Annotation {
  id: string;
  url: string;
  title: string;
  quoteText: string;
  prefixText: string;
  suffixText: string;
  startOffset: number;
  endOffset: number;
  color: string;
  commentText: string;
  status: AnnotationStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationCreateInput {
  url: string;
  title: string;
  quoteText: string;
  prefixText: string;
  suffixText: string;
  startOffset: number;
  endOffset: number;
  color?: string;
  commentText?: string;
}

export interface AnnotationUpdateCommentInput {
  url: string;
  id: string;
  commentText: string;
}

export interface AnnotationDeleteInput {
  url: string;
  id: string;
}

export const HIGHLIGHT_COLOR_OPTIONS = [
  "#ffe58f",
  "#ffd6e7",
  "#c7f9cc",
  "#bfdbfe",
  "#e9d5ff",
  "#fbcfe8",
  "#fde68a",
  "#86efac",
  "#93c5fd",
  "#fca5a5",
  "#67e8f9",
  "#d9f99d"
] as const;

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLOR_OPTIONS[0];

export const annotationStorageKey = (url: string): string => `annotations:${url}`;
