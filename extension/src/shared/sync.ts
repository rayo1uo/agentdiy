export type SyncOperationType = "create" | "update_comment" | "delete";

export interface SyncQueueItem {
  opId: string;
  opType: SyncOperationType;
  url: string;
  title?: string;
  annotationId?: string;
  quoteText?: string;
  prefixText?: string;
  suffixText?: string;
  startOffset?: number;
  endOffset?: number;
  color?: string;
  commentText?: string;
  createdAt: string;
  retryCount: number;
  nextRetryAt: string;
  lastError?: string;
}

export interface SyncConflictItem {
  opId: string;
  operation: SyncQueueItem;
  message: string;
  createdAt: string;
}

export interface SyncPushRequest {
  device_id: string;
  device_name: string;
  platform: string;
  operations: Array<{
    op_id: string;
    op_type: SyncOperationType;
    url: string;
    title?: string;
    annotation_id?: string;
    quote_text?: string;
    prefix_text?: string;
    suffix_text?: string;
    start_offset?: number;
    end_offset?: number;
    color?: string;
    comment_text?: string;
  }>;
}

export interface SyncPushResponse {
  server_time: string;
  accepted: number;
  next_cursor: number;
  conflicts: Array<{ op_id: string; message: string }>;
}

export interface SyncEvent {
  id: number;
  user_id: string;
  device_id: string;
  op_id: string;
  annotation_id: string;
  op_type: SyncOperationType;
  payload: unknown;
  created_at: string;
}

export interface SyncPullResponse {
  server_time: string;
  next_cursor: number;
  events: SyncEvent[];
  conflicts: Array<{ op_id: string; message: string }>;
}
