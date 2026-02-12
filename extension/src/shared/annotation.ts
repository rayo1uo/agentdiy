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

export const DEFAULT_HIGHLIGHT_COLOR = "#ffe58f";

export const annotationStorageKey = (url: string): string => `annotations:${url}`;
