import {
  DEFAULT_HIGHLIGHT_COLOR,
  annotationStorageKey,
  type Annotation,
  type AnnotationCreateInput,
  type AnnotationDeleteInput,
  type AnnotationUpdateCommentInput
} from "@/shared/annotation";
import type {
  AnnotationChangedEvent,
  AnnotationListResponse,
  RuntimeRequest,
  RuntimeResponse
} from "@/shared/messages";

const nowISO = (): string => new Date().toISOString();

const createAnnotation = (payload: AnnotationCreateInput): Annotation => {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  const now = nowISO();
  return {
    id: `${timestamp}-${randomSuffix}`,
    url: payload.url,
    title: payload.title,
    quoteText: payload.quoteText,
    prefixText: payload.prefixText,
    suffixText: payload.suffixText,
    startOffset: payload.startOffset,
    endOffset: payload.endOffset,
    color: payload.color ?? DEFAULT_HIGHLIGHT_COLOR,
    commentText: payload.commentText ?? "",
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now
  };
};

const listAnnotations = async (url: string): Promise<Annotation[]> => {
  const key = annotationStorageKey(url);
  const result = await chrome.storage.local.get(key);
  const annotations = (result[key] ?? []) as Annotation[];
  return annotations.filter((annotation) => annotation.status === "active");
};

const saveAnnotations = async (url: string, annotations: Annotation[]): Promise<void> => {
  const key = annotationStorageKey(url);
  await chrome.storage.local.set({ [key]: annotations });
};

const emitChanged = async (url: string): Promise<void> => {
  const event: AnnotationChangedEvent = {
    type: "annotation.changed",
    payload: { url }
  };

  try {
    await chrome.runtime.sendMessage(event);
  } catch {
    // No listening UI is open; this is expected.
  }
};

const handleCreate = async (payload: AnnotationCreateInput): Promise<Annotation> => {
  const annotations = await listAnnotations(payload.url);
  const created = createAnnotation(payload);
  annotations.push(created);
  await saveAnnotations(payload.url, annotations);
  await emitChanged(payload.url);
  return created;
};

const handleUpdateComment = async (
  payload: AnnotationUpdateCommentInput
): Promise<Annotation | null> => {
  const annotations = await listAnnotations(payload.url);
  const target = annotations.find((annotation) => annotation.id === payload.id);
  if (!target) {
    return null;
  }

  target.commentText = payload.commentText;
  target.version += 1;
  target.updatedAt = nowISO();
  await saveAnnotations(payload.url, annotations);
  await emitChanged(payload.url);
  return target;
};

const handleDelete = async (payload: AnnotationDeleteInput): Promise<boolean> => {
  const annotations = await listAnnotations(payload.url);
  const next = annotations.filter((annotation) => annotation.id !== payload.id);
  if (next.length === annotations.length) {
    return false;
  }

  await saveAnnotations(payload.url, next);
  await emitChanged(payload.url);
  return true;
};

const ok = <T>(data: T): RuntimeResponse<T> => ({ ok: true, data });
const fail = (error: string): RuntimeResponse => ({ ok: false, error });

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Side panel is optional in some environments.
  });
});

chrome.runtime.onMessage.addListener((request: RuntimeRequest, _sender, sendResponse) => {
  const run = async (): Promise<void> => {
    try {
      switch (request.type) {
        case "annotation.list": {
          const annotations = await listAnnotations(request.payload.url);
          sendResponse(ok<AnnotationListResponse>({ annotations }));
          return;
        }
        case "annotation.create": {
          const annotation = await handleCreate(request.payload);
          sendResponse(ok(annotation));
          return;
        }
        case "annotation.updateComment": {
          const annotation = await handleUpdateComment(request.payload);
          if (!annotation) {
            sendResponse(fail("Annotation not found"));
            return;
          }
          sendResponse(ok(annotation));
          return;
        }
        case "annotation.delete": {
          const removed = await handleDelete(request.payload);
          if (!removed) {
            sendResponse(fail("Annotation not found"));
            return;
          }
          sendResponse(ok({ removed: true }));
          return;
        }
        case "annotation.refresh":
        case "annotation.focus": {
          sendResponse(ok({ forwarded: true }));
          return;
        }
        default: {
          sendResponse(fail("Unsupported request type"));
          return;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected background error";
      sendResponse(fail(message));
    }
  };

  void run();
  return true;
});
