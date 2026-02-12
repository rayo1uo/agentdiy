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
import type {
  SyncConflictItem,
  SyncEvent,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  SyncQueueItem
} from "@/shared/sync";

const STORAGE_KEY = {
  syncEnabled: "settings:syncEnabled",
  apiBaseURL: "settings:apiBaseUrl",
  accessToken: "auth:accessToken",
  refreshToken: "auth:refreshToken",
  deviceID: "sync:deviceId",
  queue: "sync:queue",
  conflicts: "sync:conflicts",
  cursor: "sync:cursor",
  lastSyncAt: "sync:lastSyncAt",
  lastSyncError: "sync:lastSyncError"
} as const;

const SYNC_ALARM_NAME = "annota-sync";
const MAX_PUSH_BATCH = 50;
const MAX_PULL_BATCH = 100;
const MAX_CONFLICT_ITEMS = 200;
const MAX_RETRY_ATTEMPTS = 5;

type SyncConfig = {
  enabled: boolean;
  apiBaseURL: string;
  accessToken: string;
  refreshToken: string;
  deviceID: string;
  deviceName: string;
  platform: string;
};

type ServerAnnotation = {
  id: string;
  user_id?: string;
  url: string;
  title: string;
  quote_text: string;
  prefix_text: string;
  suffix_text: string;
  start_offset: number;
  end_offset: number;
  color: string;
  comment_text: string;
  status: "active" | "deleted";
  version: number;
  created_at: string;
  updated_at: string;
};

let syncInFlight: Promise<void> | null = null;

const nowISO = (): string => new Date().toISOString();
const nowMS = (): number => Date.now();

const makeOperationID = (): string => {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 9);
  return `${timestamp}-${randomSuffix}`;
};

const normalizeBaseURL = (value: string): string => value.trim().replace(/\/+$/, "");

const createAnnotation = (payload: AnnotationCreateInput): Annotation => {
  const now = nowISO();
  return {
    id: makeOperationID(),
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

const upsertAnnotation = async (annotation: Annotation): Promise<void> => {
  const annotations = await listAnnotations(annotation.url);
  const index = annotations.findIndex((current) => current.id === annotation.id);
  if (index >= 0) {
    annotations[index] = annotation;
  } else {
    annotations.push(annotation);
  }
  await saveAnnotations(annotation.url, annotations);
};

const removeAnnotation = async (url: string, annotationID: string): Promise<void> => {
  const annotations = await listAnnotations(url);
  const next = annotations.filter((annotation) => annotation.id !== annotationID);
  await saveAnnotations(url, next);
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

const normalizeQueueItem = (item: Partial<SyncQueueItem>): SyncQueueItem | null => {
  const opId = (item.opId ?? "").trim();
  const url = (item.url ?? "").trim();
  const opType = item.opType;
  if (!opId || !url || !opType) {
    return null;
  }

  return {
    opId,
    opType,
    url,
    title: item.title,
    annotationId: item.annotationId,
    quoteText: item.quoteText,
    prefixText: item.prefixText,
    suffixText: item.suffixText,
    startOffset: item.startOffset,
    endOffset: item.endOffset,
    color: item.color,
    commentText: item.commentText,
    createdAt: item.createdAt ?? nowISO(),
    retryCount: Number.isFinite(item.retryCount) ? Number(item.retryCount) : 0,
    nextRetryAt: item.nextRetryAt ?? "",
    lastError: item.lastError
  };
};

const getSyncQueue = async (): Promise<SyncQueueItem[]> => {
  const result = await chrome.storage.local.get(STORAGE_KEY.queue);
  const queue = (result[STORAGE_KEY.queue] ?? []) as Array<Partial<SyncQueueItem>>;
  return queue
    .map(normalizeQueueItem)
    .filter((item): item is SyncQueueItem => item !== null);
};

const saveSyncQueue = async (queue: SyncQueueItem[]): Promise<void> => {
  await chrome.storage.local.set({ [STORAGE_KEY.queue]: queue });
};

const getSyncConflicts = async (): Promise<SyncConflictItem[]> => {
  const result = await chrome.storage.local.get(STORAGE_KEY.conflicts);
  return (result[STORAGE_KEY.conflicts] ?? []) as SyncConflictItem[];
};

const saveSyncConflicts = async (items: SyncConflictItem[]): Promise<void> => {
  const trimmed = items.slice(-MAX_CONFLICT_ITEMS);
  await chrome.storage.local.set({ [STORAGE_KEY.conflicts]: trimmed });
};

const appendSyncConflicts = async (items: SyncConflictItem[]): Promise<void> => {
  if (items.length === 0) {
    return;
  }

  const current = await getSyncConflicts();
  await saveSyncConflicts([...current, ...items]);
};

const enqueueOperation = async (operation: Omit<SyncQueueItem, "retryCount" | "nextRetryAt">): Promise<void> => {
  const queue = await getSyncQueue();
  queue.push({
    ...operation,
    retryCount: 0,
    nextRetryAt: ""
  });
  await saveSyncQueue(queue);
};

const getSyncCursor = async (): Promise<number> => {
  const result = await chrome.storage.local.get(STORAGE_KEY.cursor);
  const cursor = result[STORAGE_KEY.cursor];
  return typeof cursor === "number" ? cursor : 0;
};

const setSyncCursor = async (cursor: number): Promise<void> => {
  await chrome.storage.local.set({ [STORAGE_KEY.cursor]: cursor });
};

const getOrCreateDeviceID = async (): Promise<string> => {
  const result = await chrome.storage.local.get(STORAGE_KEY.deviceID);
  const existing = result[STORAGE_KEY.deviceID];
  if (typeof existing === "string" && existing.trim() !== "") {
    return existing;
  }

  const created = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : makeOperationID();
  await chrome.storage.local.set({ [STORAGE_KEY.deviceID]: created });
  return created;
};

const loadSyncConfig = async (): Promise<SyncConfig> => {
  const [syncSettings, localSettings] = await Promise.all([
    chrome.storage.sync.get([STORAGE_KEY.syncEnabled, STORAGE_KEY.apiBaseURL]),
    chrome.storage.local.get([STORAGE_KEY.accessToken, STORAGE_KEY.refreshToken])
  ]);

  const enabled =
    typeof syncSettings[STORAGE_KEY.syncEnabled] === "boolean"
      ? (syncSettings[STORAGE_KEY.syncEnabled] as boolean)
      : true;

  const apiBaseURL = normalizeBaseURL((syncSettings[STORAGE_KEY.apiBaseURL] as string) ?? "");
  const accessToken = (localSettings[STORAGE_KEY.accessToken] as string) ?? "";
  const refreshToken = (localSettings[STORAGE_KEY.refreshToken] as string) ?? "";

  return {
    enabled,
    apiBaseURL,
    accessToken,
    refreshToken,
    deviceID: await getOrCreateDeviceID(),
    deviceName: navigator.platform || "unknown-device",
    platform: navigator.platform?.toLowerCase().includes("mac") ? "mac" : "windows"
  };
};

const saveTokens = async (accessToken: string, refreshToken: string): Promise<void> => {
  await chrome.storage.local.set({
    [STORAGE_KEY.accessToken]: accessToken,
    [STORAGE_KEY.refreshToken]: refreshToken
  });
};

const refreshAccessToken = async (config: SyncConfig): Promise<SyncConfig | null> => {
  if (!config.refreshToken || !config.apiBaseURL) {
    return null;
  }

  const response = await fetch(`${config.apiBaseURL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: config.refreshToken })
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    token_pair?: { access_token?: string; refresh_token?: string };
  };

  const accessToken = data.token_pair?.access_token ?? "";
  const refreshToken = data.token_pair?.refresh_token ?? "";
  if (!accessToken || !refreshToken) {
    return null;
  }

  await saveTokens(accessToken, refreshToken);
  return {
    ...config,
    accessToken,
    refreshToken
  };
};

const fetchWithAuth = async (
  config: SyncConfig,
  path: string,
  init: RequestInit,
  retryOnUnauthorized = true
): Promise<{ response: Response; config: SyncConfig }> => {
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${config.accessToken}`);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${config.apiBaseURL}${path}`, {
    ...init,
    headers
  });

  if (response.status !== 401 || !retryOnUnauthorized) {
    return { response, config };
  }

  const refreshed = await refreshAccessToken(config);
  if (!refreshed) {
    return { response, config };
  }

  const retryHeaders = new Headers(init.headers ?? {});
  retryHeaders.set("Authorization", `Bearer ${refreshed.accessToken}`);
  if (!retryHeaders.has("Content-Type") && init.body) {
    retryHeaders.set("Content-Type", "application/json");
  }

  const retryResponse = await fetch(`${refreshed.apiBaseURL}${path}`, {
    ...init,
    headers: retryHeaders
  });

  return { response: retryResponse, config: refreshed };
};

const toPushRequest = (config: SyncConfig, operations: SyncQueueItem[]): SyncPushRequest => ({
  device_id: config.deviceID,
  device_name: config.deviceName,
  platform: config.platform,
  operations: operations.map((operation) => ({
    op_id: operation.opId,
    op_type: operation.opType,
    url: operation.url,
    title: operation.title,
    annotation_id: operation.annotationId,
    quote_text: operation.quoteText,
    prefix_text: operation.prefixText,
    suffix_text: operation.suffixText,
    start_offset: operation.startOffset,
    end_offset: operation.endOffset,
    color: operation.color,
    comment_text: operation.commentText
  }))
});

const toLocalAnnotation = (server: ServerAnnotation): Annotation => ({
  id: server.id,
  url: server.url,
  title: server.title,
  quoteText: server.quote_text,
  prefixText: server.prefix_text,
  suffixText: server.suffix_text,
  startOffset: server.start_offset,
  endOffset: server.end_offset,
  color: server.color,
  commentText: server.comment_text,
  status: server.status,
  version: server.version,
  createdAt: server.created_at,
  updatedAt: server.updated_at
});

const canUseBackendAnnotations = (config: SyncConfig): boolean =>
  config.apiBaseURL !== "" && config.accessToken !== "";

const listAnnotationsFromBackend = async (config: SyncConfig, url: string): Promise<Annotation[] | null> => {
  if (!canUseBackendAnnotations(config)) {
    return null;
  }

  try {
    const { response } = await fetchWithAuth(
      config,
      `/api/v1/annotations?url=${encodeURIComponent(url)}`,
      { method: "GET" }
    );
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as { annotations?: ServerAnnotation[] };
    const annotations = (body.annotations ?? []).map(toLocalAnnotation);
    return annotations.filter((annotation) => annotation.status === "active");
  } catch {
    return null;
  }
};

const createAnnotationOnBackend = async (
  config: SyncConfig,
  annotation: Annotation
): Promise<Annotation | null> => {
  if (!canUseBackendAnnotations(config)) {
    return null;
  }

  try {
    const { response } = await fetchWithAuth(config, "/api/v1/annotations", {
      method: "POST",
      body: JSON.stringify({
        annotation_id: annotation.id,
        url: annotation.url,
        title: annotation.title,
        quote_text: annotation.quoteText,
        prefix_text: annotation.prefixText,
        suffix_text: annotation.suffixText,
        start_offset: annotation.startOffset,
        end_offset: annotation.endOffset,
        color: annotation.color,
        comment_text: annotation.commentText
      })
    });
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as ServerAnnotation;
    return toLocalAnnotation(body);
  } catch {
    return null;
  }
};

const updateAnnotationCommentOnBackend = async (
  config: SyncConfig,
  payload: AnnotationUpdateCommentInput
): Promise<Annotation | null> => {
  if (!canUseBackendAnnotations(config)) {
    return null;
  }

  try {
    const { response } = await fetchWithAuth(
      config,
      `/api/v1/annotations/${encodeURIComponent(payload.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          url: payload.url,
          comment_text: payload.commentText
        })
      }
    );
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as ServerAnnotation;
    return toLocalAnnotation(body);
  } catch {
    return null;
  }
};

const deleteAnnotationOnBackend = async (
  config: SyncConfig,
  payload: AnnotationDeleteInput
): Promise<boolean> => {
  if (!canUseBackendAnnotations(config)) {
    return false;
  }

  try {
    const { response } = await fetchWithAuth(
      config,
      `/api/v1/annotations/${encodeURIComponent(payload.id)}?url=${encodeURIComponent(payload.url)}`,
      { method: "DELETE" }
    );
    return response.ok;
  } catch {
    return false;
  }
};

const parseEventPayload = (payload: unknown): unknown => {
  if (typeof payload !== "string") {
    return payload;
  }

  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
};

const applyPulledEvents = async (events: SyncEvent[]): Promise<void> => {
  const changedURLs = new Set<string>();

  for (const event of events) {
    const payload = parseEventPayload(event.payload);

    if (event.op_type === "create" || event.op_type === "update_comment") {
      const data = payload as { annotation?: ServerAnnotation } | null;
      if (!data?.annotation) {
        continue;
      }
      const annotation = toLocalAnnotation(data.annotation);
      await upsertAnnotation(annotation);
      changedURLs.add(annotation.url);
      continue;
    }

    if (event.op_type === "delete") {
      const data = payload as { annotation_id?: string; url?: string } | null;
      if (!data?.annotation_id || !data?.url) {
        continue;
      }
      await removeAnnotation(data.url, data.annotation_id);
      changedURLs.add(data.url);
    }
  }

  for (const url of changedURLs) {
    await emitChanged(url);
  }
};

const createConflict = (operation: SyncQueueItem, message: string): SyncConflictItem => ({
  opId: operation.opId,
  operation,
  message,
  createdAt: nowISO()
});

const isQueueItemReady = (item: SyncQueueItem): boolean => {
  if (!item.nextRetryAt) {
    return true;
  }
  const retryAt = Date.parse(item.nextRetryAt);
  if (!Number.isFinite(retryAt)) {
    return true;
  }
  return retryAt <= nowMS();
};

const removeBatchFromQueue = (queue: SyncQueueItem[], batchOpIDs: Set<string>): SyncQueueItem[] =>
  queue.filter((item) => !batchOpIDs.has(item.opId));

const applyRetryBackoff = (
  queue: SyncQueueItem[],
  batchOpIDs: Set<string>,
  reason: string
): { queue: SyncQueueItem[]; exhaustedConflicts: SyncConflictItem[] } => {
  const exhaustedConflicts: SyncConflictItem[] = [];
  const nextQueue: SyncQueueItem[] = [];

  for (const item of queue) {
    if (!batchOpIDs.has(item.opId)) {
      nextQueue.push(item);
      continue;
    }

    const nextRetryCount = item.retryCount + 1;
    if (nextRetryCount > MAX_RETRY_ATTEMPTS) {
      exhaustedConflicts.push(createConflict(item, `exceeded retries: ${reason}`));
      continue;
    }

    const delaySeconds = Math.min(15 * 2 ** nextRetryCount, 15 * 60);
    nextQueue.push({
      ...item,
      retryCount: nextRetryCount,
      nextRetryAt: new Date(nowMS() + delaySeconds * 1000).toISOString(),
      lastError: reason
    });
  }

  return { queue: nextQueue, exhaustedConflicts };
};

const syncNow = async (_reason: string): Promise<void> => {
  const config = await loadSyncConfig();
  if (!config.enabled || !config.apiBaseURL || !config.accessToken) {
    return;
  }

  let workingConfig = config;
  let syncError = "";

  let queue = await getSyncQueue();
  while (true) {
    const ready = queue.filter(isQueueItemReady);
    if (ready.length === 0) {
      break;
    }

    const batch = ready.slice(0, MAX_PUSH_BATCH);
    const batchOpIDs = new Set(batch.map((item) => item.opId));
    const payload = toPushRequest(workingConfig, batch);

    let response: Response;
    try {
      const result = await fetchWithAuth(workingConfig, "/api/v1/sync/push", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      workingConfig = result.config;
      response = result.response;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "network failure";
      const retried = applyRetryBackoff(queue, batchOpIDs, reason);
      queue = retried.queue;
      await saveSyncQueue(queue);
      await appendSyncConflicts(retried.exhaustedConflicts);
      await chrome.storage.local.set({ [STORAGE_KEY.lastSyncError]: `sync push network error: ${reason}` });
      return;
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        await chrome.storage.local.set({ [STORAGE_KEY.lastSyncError]: "sync auth failed, please refresh token" });
        return;
      }

      if (response.status >= 500 || response.status === 429) {
        const reason = `status ${response.status}`;
        const retried = applyRetryBackoff(queue, batchOpIDs, reason);
        queue = retried.queue;
        await saveSyncQueue(queue);
        await appendSyncConflicts(retried.exhaustedConflicts);
        await chrome.storage.local.set({ [STORAGE_KEY.lastSyncError]: `sync push retry scheduled: ${reason}` });
        return;
      }

      const conflicts = batch.map((item) => createConflict(item, `sync push rejected with status ${response.status}`));
      queue = removeBatchFromQueue(queue, batchOpIDs);
      await saveSyncQueue(queue);
      await appendSyncConflicts(conflicts);
      syncError = `sync push rejected with status ${response.status}`;
      continue;
    }

    const responseJSON = (await response.json()) as SyncPushResponse;
    const conflictMap = new Map(responseJSON.conflicts.map((item) => [item.op_id, item.message]));

    const conflictItems: SyncConflictItem[] = [];
    for (const item of batch) {
      const conflictMessage = conflictMap.get(item.opId);
      if (!conflictMessage) {
        continue;
      }
      conflictItems.push(createConflict(item, conflictMessage));
    }

    queue = removeBatchFromQueue(queue, batchOpIDs);
    await saveSyncQueue(queue);
    await appendSyncConflicts(conflictItems);

    if (conflictItems.length > 0) {
      syncError = `${conflictItems.length} conflict operation(s) moved to conflict queue`;
    }
  }

  let cursor = await getSyncCursor();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let response: Response;
    try {
      const result = await fetchWithAuth(
        workingConfig,
        `/api/v1/sync/pull?cursor=${cursor}&limit=${MAX_PULL_BATCH}`,
        { method: "GET" }
      );
      workingConfig = result.config;
      response = result.response;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "network failure";
      syncError = `sync pull network error: ${reason}`;
      break;
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        syncError = "sync pull auth failed, please refresh token";
        break;
      }

      if (response.status >= 500 || response.status === 429) {
        syncError = `sync pull temporary failure: status ${response.status}`;
        continue;
      }

      syncError = `sync pull failed with status ${response.status}`;
      break;
    }

    const responseJSON = (await response.json()) as SyncPullResponse;
    if (responseJSON.events.length === 0) {
      cursor = responseJSON.next_cursor;
      break;
    }

    await applyPulledEvents(responseJSON.events);
    cursor = responseJSON.next_cursor;
  }

  await setSyncCursor(cursor);
  await chrome.storage.local.set({
    [STORAGE_KEY.lastSyncAt]: nowISO(),
    [STORAGE_KEY.lastSyncError]: syncError
  });
};

const scheduleSync = (reason: string): void => {
  if (syncInFlight) {
    return;
  }
  syncInFlight = syncNow(reason)
    .catch((error) => {
      const message = error instanceof Error ? error.message : "unknown sync error";
      void chrome.storage.local.set({ [STORAGE_KEY.lastSyncError]: message });
    })
    .finally(() => {
      syncInFlight = null;
    });
};

const handleList = async (url: string): Promise<Annotation[]> => {
  const config = await loadSyncConfig();
  const remoteAnnotations = await listAnnotationsFromBackend(config, url);
  if (remoteAnnotations) {
    await saveAnnotations(url, remoteAnnotations);
    return remoteAnnotations;
  }
  return listAnnotations(url);
};

const handleCreate = async (payload: AnnotationCreateInput): Promise<Annotation> => {
  const annotations = await listAnnotations(payload.url);
  const created = createAnnotation(payload);
  annotations.push(created);
  await saveAnnotations(payload.url, annotations);
  const config = await loadSyncConfig();
  const remoteCreated = await createAnnotationOnBackend(config, created);
  if (!remoteCreated) {
    await enqueueOperation({
      opId: makeOperationID(),
      opType: "create",
      url: created.url,
      title: created.title,
      annotationId: created.id,
      quoteText: created.quoteText,
      prefixText: created.prefixText,
      suffixText: created.suffixText,
      startOffset: created.startOffset,
      endOffset: created.endOffset,
      color: created.color,
      commentText: created.commentText,
      createdAt: nowISO(),
      lastError: ""
    });
    scheduleSync("annotation-create-fallback");
  } else {
    await upsertAnnotation(remoteCreated);
  }

  await emitChanged(payload.url);
  return remoteCreated ?? created;
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
  const config = await loadSyncConfig();
  const remoteUpdated = await updateAnnotationCommentOnBackend(config, payload);
  if (!remoteUpdated) {
    await enqueueOperation({
      opId: makeOperationID(),
      opType: "update_comment",
      url: payload.url,
      annotationId: payload.id,
      commentText: payload.commentText,
      createdAt: nowISO(),
      lastError: ""
    });
    scheduleSync("annotation-update-comment-fallback");
  } else {
    await upsertAnnotation(remoteUpdated);
  }

  await emitChanged(payload.url);
  return remoteUpdated ?? target;
};

const handleDelete = async (payload: AnnotationDeleteInput): Promise<boolean> => {
  const annotations = await listAnnotations(payload.url);
  const next = annotations.filter((annotation) => annotation.id !== payload.id);
  if (next.length === annotations.length) {
    return false;
  }

  await saveAnnotations(payload.url, next);
  const config = await loadSyncConfig();
  const deletedOnBackend = await deleteAnnotationOnBackend(config, payload);
  if (!deletedOnBackend) {
    await enqueueOperation({
      opId: makeOperationID(),
      opType: "delete",
      url: payload.url,
      annotationId: payload.id,
      createdAt: nowISO(),
      lastError: ""
    });
    scheduleSync("annotation-delete-fallback");
  }

  await emitChanged(payload.url);
  return true;
};

const listSyncConflicts = async (): Promise<{
  conflicts: SyncConflictItem[];
  queueLength: number;
  lastSyncAt: string;
  lastSyncError: string;
}> => {
  const [conflicts, queue, status] = await Promise.all([
    getSyncConflicts(),
    getSyncQueue(),
    chrome.storage.local.get([STORAGE_KEY.lastSyncAt, STORAGE_KEY.lastSyncError])
  ]);

  return {
    conflicts,
    queueLength: queue.length,
    lastSyncAt: (status[STORAGE_KEY.lastSyncAt] as string) ?? "",
    lastSyncError: (status[STORAGE_KEY.lastSyncError] as string) ?? ""
  };
};

const getSyncState = async (url?: string): Promise<{
  queueLength: number;
  conflictCount: number;
  pendingAnnotationIDs: string[];
  conflictAnnotationIDs: string[];
  conflictOpIDs: string[];
  conflictOpIDsByAnnotationID: Record<string, string[]>;
  lastSyncAt: string;
  lastSyncError: string;
}> => {
  const [queue, conflicts, status] = await Promise.all([
    getSyncQueue(),
    getSyncConflicts(),
    chrome.storage.local.get([STORAGE_KEY.lastSyncAt, STORAGE_KEY.lastSyncError])
  ]);

  const urlFilter = (value?: string): boolean => (url ? value === url : true);
  const pendingAnnotationIDs = Array.from(
    new Set(
      queue
        .filter((item) => urlFilter(item.url))
        .map((item) => item.annotationId)
        .filter((value): value is string => typeof value === "string" && value !== "")
    )
  );

  const conflictAnnotationIDs = Array.from(
    new Set(
      conflicts
        .filter((item) => urlFilter(item.operation.url))
        .map((item) => item.operation.annotationId)
        .filter((value): value is string => typeof value === "string" && value !== "")
    )
  );

  const conflictOpIDs = Array.from(
    new Set(
      conflicts
        .filter((item) => urlFilter(item.operation.url))
        .map((item) => item.opId)
        .filter((value): value is string => typeof value === "string" && value !== "")
    )
  );

  const conflictOpIDsByAnnotationID: Record<string, string[]> = {};
  for (const item of conflicts) {
    if (!urlFilter(item.operation.url)) {
      continue;
    }
    const annotationID = item.operation.annotationId?.trim();
    if (!annotationID) {
      continue;
    }
    if (!conflictOpIDsByAnnotationID[annotationID]) {
      conflictOpIDsByAnnotationID[annotationID] = [];
    }
    if (!conflictOpIDsByAnnotationID[annotationID].includes(item.opId)) {
      conflictOpIDsByAnnotationID[annotationID].push(item.opId);
    }
  }

  return {
    queueLength: queue.filter((item) => urlFilter(item.url)).length,
    conflictCount: conflicts.filter((item) => urlFilter(item.operation.url)).length,
    pendingAnnotationIDs,
    conflictAnnotationIDs,
    conflictOpIDs,
    conflictOpIDsByAnnotationID,
    lastSyncAt: (status[STORAGE_KEY.lastSyncAt] as string) ?? "",
    lastSyncError: (status[STORAGE_KEY.lastSyncError] as string) ?? ""
  };
};

const retrySyncConflicts = async (opIDs?: string[]): Promise<{ requeued: number; remaining: number }> => {
  const conflicts = await getSyncConflicts();
  const targetSet = opIDs && opIDs.length > 0 ? new Set(opIDs) : null;

  const selected = conflicts.filter((item) => (targetSet ? targetSet.has(item.opId) : true));
  const remaining = conflicts.filter((item) => (targetSet ? !targetSet.has(item.opId) : false));

  if (selected.length === 0) {
    return { requeued: 0, remaining: conflicts.length };
  }

  const queue = await getSyncQueue();
  const existingOpIDs = new Set(queue.map((item) => item.opId));

  let requeued = 0;
  for (const item of selected) {
    if (existingOpIDs.has(item.operation.opId)) {
      continue;
    }
    queue.push({
      ...item.operation,
      retryCount: 0,
      nextRetryAt: "",
      lastError: ""
    });
    existingOpIDs.add(item.operation.opId);
    requeued += 1;
  }

  await Promise.all([saveSyncQueue(queue), saveSyncConflicts(remaining)]);
  if (requeued > 0) {
    scheduleSync("retry-conflicts");
  }

  return { requeued, remaining: remaining.length };
};

const removeSyncConflicts = async (opIDs?: string[]): Promise<{ removed: number; remaining: number }> => {
  const conflicts = await getSyncConflicts();
  if (!opIDs || opIDs.length === 0) {
    await saveSyncConflicts([]);
    return { removed: conflicts.length, remaining: 0 };
  }

  const targetSet = new Set(opIDs);
  const remaining = conflicts.filter((item) => !targetSet.has(item.opId));
  await saveSyncConflicts(remaining);
  return { removed: conflicts.length - remaining.length, remaining: remaining.length };
};

const ok = <T>(data: T): RuntimeResponse<T> => ({ ok: true, data });
const fail = (error: string): RuntimeResponse => ({ ok: false, error });

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Side panel is optional in some environments.
  });

  chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: 2
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: 2
  });
  scheduleSync("runtime-startup");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SYNC_ALARM_NAME) {
    return;
  }
  scheduleSync("alarm");
});

chrome.runtime.onMessage.addListener((request: RuntimeRequest, _sender, sendResponse) => {
  const run = async (): Promise<void> => {
    try {
      switch (request.type) {
        case "annotation.list": {
          const annotations = await handleList(request.payload.url);
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
        case "sync.now": {
          scheduleSync(request.payload.reason ?? "manual");
          sendResponse(ok({ scheduled: true }));
          return;
        }
        case "sync.state": {
          const result = await getSyncState(request.payload?.url);
          sendResponse(ok(result));
          return;
        }
        case "sync.conflicts.list": {
          const conflicts = await listSyncConflicts();
          sendResponse(ok(conflicts));
          return;
        }
        case "sync.conflicts.retry": {
          const result = await retrySyncConflicts(request.payload?.opIds);
          sendResponse(ok(result));
          return;
        }
        case "sync.conflicts.remove": {
          const result = await removeSyncConflicts(request.payload?.opIds);
          sendResponse(ok(result));
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
