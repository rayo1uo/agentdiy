import type {
  Annotation,
  AnnotationCreateInput,
  AnnotationDeleteInput,
  AnnotationUpdateCommentInput
} from "./annotation";

export type RuntimeRequest =
  | { type: "annotation.list"; payload: { url: string } }
  | { type: "annotation.create"; payload: AnnotationCreateInput }
  | { type: "annotation.updateComment"; payload: AnnotationUpdateCommentInput }
  | { type: "annotation.delete"; payload: AnnotationDeleteInput }
  | { type: "sync.now"; payload: { reason?: string } }
  | { type: "sync.state"; payload?: { url?: string } }
  | { type: "sync.conflicts.list"; payload?: {} }
  | { type: "sync.conflicts.retry"; payload?: { opIds?: string[] } }
  | { type: "sync.conflicts.remove"; payload?: { opIds?: string[] } }
  | { type: "annotation.refresh"; payload: { url: string } }
  | { type: "annotation.focus"; payload: { id: string } };

export type RuntimeResponse<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
};

export interface AnnotationChangedEvent {
  type: "annotation.changed";
  payload: { url: string };
}

export interface AnnotationListResponse {
  annotations: Annotation[];
}
