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
  AnnotationURLSummary,
  AnnotationURLSummaryResponse,
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
  dialogDefaultEnabled: "settings:dialogDefaultEnabled",
  dialogSiteMap: "settings:dialogSiteEnabledMap",
  legacyDialogEnabled: "settings:dialogEnabledByAction",
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
let annotationURLMigrationInFlight: Promise<void> | null = null;

const nowISO = (): string => new Date().toISOString();
const nowMS = (): number => Date.now();

const makeOperationID = (): string => {
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 9);
  return `${timestamp}-${randomSuffix}`;
};

const normalizeBaseURL = (value: string): string => value.trim().replace(/\/+$/, "");
const DEFAULT_DIALOG_ENABLED = true;
type DialogSiteMap = Record<string, boolean>;

const normalizeAnnotationURL = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return trimmed;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    const hashIndex = trimmed.indexOf("#");
    return hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed;
  }
};

const parseSiteScope = (value: string): string | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};

const normalizeDialogSiteMap = (raw: unknown): DialogSiteMap => {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const next: DialogSiteMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key === "string" && typeof value === "boolean" && key.trim()) {
      next[key] = value;
    }
  }
  return next;
};

type DialogSettings = {
  defaultEnabled: boolean;
  siteMap: DialogSiteMap;
};

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

const mergeAnnotationsByID = (items: Annotation[]): Annotation[] => {
  const merged = new Map<string, Annotation>();
  for (const item of items) {
    const existing = merged.get(item.id);
    if (!existing || shouldReplaceAnnotation(existing, item)) {
      merged.set(item.id, item);
    }
  }
  return sortAnnotationsByUpdatedAt(Array.from(merged.values()));
};

const parseTimestamp = (value: string): number => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

const shouldReplaceAnnotation = (current: Annotation, incoming: Annotation): boolean => {
  if (incoming.version > current.version) {
    return true;
  }
  if (incoming.version < current.version) {
    return false;
  }

  const incomingUpdatedAt = parseTimestamp(incoming.updatedAt || incoming.createdAt);
  const currentUpdatedAt = parseTimestamp(current.updatedAt || current.createdAt);
  if (incomingUpdatedAt > currentUpdatedAt) {
    return true;
  }
  if (incomingUpdatedAt < currentUpdatedAt) {
    return false;
  }

  const incomingCreatedAt = parseTimestamp(incoming.createdAt);
  const currentCreatedAt = parseTimestamp(current.createdAt);
  if (incomingCreatedAt > currentCreatedAt) {
    return true;
  }
  if (incomingCreatedAt < currentCreatedAt) {
    return false;
  }

  return (
    incoming.url !== current.url ||
    incoming.title !== current.title ||
    incoming.quoteText !== current.quoteText ||
    incoming.prefixText !== current.prefixText ||
    incoming.suffixText !== current.suffixText ||
    incoming.startOffset !== current.startOffset ||
    incoming.endOffset !== current.endOffset ||
    incoming.color !== current.color ||
    incoming.commentText !== current.commentText ||
    incoming.status !== current.status
  );
};

const sortAnnotationsByUpdatedAt = (items: Annotation[]): Annotation[] =>
  items.sort((a, b) => {
    const bTime = parseTimestamp(b.updatedAt || b.createdAt);
    const aTime = parseTimestamp(a.updatedAt || a.createdAt);
    if (bTime !== aTime) {
      return bTime - aTime;
    }
    return a.id.localeCompare(b.id);
  });

const upsertAnnotation = async (annotation: Annotation): Promise<void> => {
  const annotations = await listAnnotations(annotation.url);
  const index = annotations.findIndex((current) => current.id === annotation.id);
  if (index >= 0) {
    if (shouldReplaceAnnotation(annotations[index], annotation)) {
      annotations[index] = annotation;
    }
  } else {
    annotations.push(annotation);
  }
  await saveAnnotations(annotation.url, annotations);
};

const prunePendingUpdateOperations = async (url: string, annotationID: string): Promise<void> => {
  const queue = await getSyncQueue();
  const nextQueue = queue.filter(
    (item) => !(item.opType === "update_comment" && item.url === url && item.annotationId === annotationID)
  );
  if (nextQueue.length !== queue.length) {
    await saveSyncQueue(nextQueue);
  }
};

const prunePendingDeleteOperations = async (url: string, annotationID: string): Promise<void> => {
  const queue = await getSyncQueue();
  const nextQueue = queue.filter((item) => !(item.opType === "delete" && item.url === url && item.annotationId === annotationID));
  if (nextQueue.length !== queue.length) {
    await saveSyncQueue(nextQueue);
  }
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
  const url = normalizeAnnotationURL((item.url ?? "").trim());
  const annotationId = (item.annotationId ?? "").trim();
  const opType = item.opType;
  if (!opId || !url || !opType) {
    return null;
  }

  return {
    opId,
    opType,
    url,
    title: item.title,
    annotationId: annotationId || undefined,
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
  const conflicts = (result[STORAGE_KEY.conflicts] ?? []) as SyncConflictItem[];
  return conflicts.map((item) => ({
    ...item,
    operation: {
      ...item.operation,
      url: normalizeAnnotationURL(item.operation.url)
    }
  }));
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

const listLocalAnnotationURLs = async (): Promise<string[]> => {
  const storageData = await chrome.storage.local.get(null);
  const urls: string[] = [];
  for (const key of Object.keys(storageData)) {
    if (!key.startsWith("annotations:")) {
      continue;
    }
    const url = key.slice("annotations:".length).trim();
    if (!url) {
      continue;
    }
    urls.push(url);
  }
  return urls;
};

const migrateAnnotationStorageURLKeys = async (): Promise<void> => {
  const storageData = await chrome.storage.local.get(null);
  const groupedByCanonicalURL = new Map<string, Annotation[]>();
  const keysToRemove: string[] = [];

  for (const [key, value] of Object.entries(storageData)) {
    if (!key.startsWith("annotations:") || !Array.isArray(value)) {
      continue;
    }

    const rawURL = key.slice("annotations:".length).trim();
    const canonicalURL = normalizeAnnotationURL(rawURL);
    if (!canonicalURL) {
      continue;
    }

    const normalizedItems: Annotation[] = (value as Annotation[])
      .filter((item) => item && typeof item.id === "string" && item.id.trim() !== "")
      .map((item) => ({
        ...item,
        url: canonicalURL
      }));

    const existing = groupedByCanonicalURL.get(canonicalURL) ?? [];
    groupedByCanonicalURL.set(canonicalURL, [...existing, ...normalizedItems]);

    if (rawURL !== canonicalURL) {
      keysToRemove.push(key);
    }
  }

  if (groupedByCanonicalURL.size === 0) {
    return;
  }

  const nextStorage: Record<string, Annotation[]> = {};
  for (const [url, items] of groupedByCanonicalURL.entries()) {
    nextStorage[annotationStorageKey(url)] = mergeAnnotationsByID(items);
  }

  await chrome.storage.local.set(nextStorage);
  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
};

const ensureAnnotationURLMigration = async (): Promise<void> => {
  if (annotationURLMigrationInFlight) {
    await annotationURLMigrationInFlight;
    return;
  }
  annotationURLMigrationInFlight = migrateAnnotationStorageURLKeys().finally(() => {
    annotationURLMigrationInFlight = null;
  });
  await annotationURLMigrationInFlight;
};

type PendingSyncState = {
  pendingAnnotationIDs: Set<string>;
  pendingDeleteAnnotationIDs: Set<string>;
};

const listPendingSyncStateByURL = async (): Promise<Map<string, PendingSyncState>> => {
  const [queue, conflicts] = await Promise.all([getSyncQueue(), getSyncConflicts()]);
  const byURL = new Map<string, PendingSyncState>();

  const ensureState = (url: string): PendingSyncState => {
    const existing = byURL.get(url);
    if (existing) {
      return existing;
    }
    const created: PendingSyncState = {
      pendingAnnotationIDs: new Set<string>(),
      pendingDeleteAnnotationIDs: new Set<string>()
    };
    byURL.set(url, created);
    return created;
  };

  const append = (url: string, opType: SyncQueueItem["opType"], annotationID?: string): void => {
    const normalizedURL = normalizeAnnotationURL(url);
    const id = annotationID?.trim();
    if (!normalizedURL || !id) {
      return;
    }
    const state = ensureState(normalizedURL);
    state.pendingAnnotationIDs.add(id);
    if (opType === "delete") {
      state.pendingDeleteAnnotationIDs.add(id);
    }
  };

  for (const item of queue) {
    append(item.url, item.opType, item.annotationId);
  }
  for (const item of conflicts) {
    append(item.operation.url, item.operation.opType, item.operation.annotationId);
  }

  return byURL;
};

const reconcileLocalWithRemote = (
  local: Annotation[],
  remote: Annotation[],
  pendingState: PendingSyncState
): Annotation[] => {
  const result = new Map<string, Annotation>();
  const pendingAnnotationIDs = pendingState.pendingAnnotationIDs;
  const pendingDeleteAnnotationIDs = pendingState.pendingDeleteAnnotationIDs;

  for (const remoteItem of remote) {
    if (pendingDeleteAnnotationIDs.has(remoteItem.id)) {
      continue;
    }
    result.set(remoteItem.id, remoteItem);
  }

  for (const localItem of local) {
    if (pendingDeleteAnnotationIDs.has(localItem.id)) {
      result.delete(localItem.id);
      continue;
    }

    if (!pendingAnnotationIDs.has(localItem.id)) {
      continue;
    }

    const remoteItem = result.get(localItem.id);
    if (!remoteItem || shouldReplaceAnnotation(remoteItem, localItem)) {
      result.set(localItem.id, localItem);
    }
  }

  return sortAnnotationsByUpdatedAt(Array.from(result.values()));
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

const loadDialogSettings = async (): Promise<DialogSettings> => {
  const result = await chrome.storage.sync.get([
    STORAGE_KEY.dialogDefaultEnabled,
    STORAGE_KEY.dialogSiteMap,
    STORAGE_KEY.legacyDialogEnabled
  ]);
  const defaultRaw = result[STORAGE_KEY.dialogDefaultEnabled];
  const legacyRaw = result[STORAGE_KEY.legacyDialogEnabled];
  const defaultEnabled =
    typeof defaultRaw === "boolean"
      ? defaultRaw
      : typeof legacyRaw === "boolean"
        ? legacyRaw
        : DEFAULT_DIALOG_ENABLED;
  const siteMap = normalizeDialogSiteMap(result[STORAGE_KEY.dialogSiteMap]);
  return { defaultEnabled, siteMap };
};

const ensureDialogSettings = async (): Promise<DialogSettings> => {
  const result = await chrome.storage.sync.get([
    STORAGE_KEY.dialogDefaultEnabled,
    STORAGE_KEY.dialogSiteMap,
    STORAGE_KEY.legacyDialogEnabled
  ]);
  const defaultRaw = result[STORAGE_KEY.dialogDefaultEnabled];
  const legacyRaw = result[STORAGE_KEY.legacyDialogEnabled];
  const siteMapRaw = result[STORAGE_KEY.dialogSiteMap];

  const defaultEnabled =
    typeof defaultRaw === "boolean"
      ? defaultRaw
      : typeof legacyRaw === "boolean"
        ? legacyRaw
        : DEFAULT_DIALOG_ENABLED;
  const siteMap = normalizeDialogSiteMap(siteMapRaw);

  const patch: Record<string, unknown> = {};
  if (typeof defaultRaw !== "boolean") {
    patch[STORAGE_KEY.dialogDefaultEnabled] = defaultEnabled;
  }
  if (!siteMapRaw || typeof siteMapRaw !== "object") {
    patch[STORAGE_KEY.dialogSiteMap] = siteMap;
  }
  if (Object.keys(patch).length > 0) {
    await chrome.storage.sync.set(patch);
  }
  return { defaultEnabled, siteMap };
};

const resolveDialogEnabledForURL = (url: string, settings: DialogSettings): boolean => {
  const scope = parseSiteScope(url);
  if (!scope) {
    return settings.defaultEnabled;
  }
  if (Object.prototype.hasOwnProperty.call(settings.siteMap, scope)) {
    return settings.siteMap[scope];
  }
  return settings.defaultEnabled;
};

const setActionAppearance = async (enabled: boolean, tabID?: number, scope?: string): Promise<void> => {
  const details = tabID != null ? { tabId: tabID } : {};
  const setBadgeTextColor =
    typeof chrome.action.setBadgeTextColor === "function"
      ? chrome.action.setBadgeTextColor({
          ...details,
          color: enabled ? "#ffffff" : "#0f172a"
        })
      : Promise.resolve();
  await Promise.all([
    chrome.action.setBadgeText({ ...details, text: enabled ? "ON" : "OFF" }),
    chrome.action.setBadgeBackgroundColor({
      ...details,
      color: enabled ? "#1e3a8a" : "#cbd5e1"
    }),
    setBadgeTextColor,
    chrome.action.setTitle({
      ...details,
      title: enabled
        ? `Annota MVP: 当前网页高亮已开启${scope ? `（${scope}）` : ""}`
        : `Annota MVP: 当前网页高亮已关闭${scope ? `（${scope}）` : ""}`
    })
  ]);
};

const resolveTargetTab = async (tabID?: number): Promise<chrome.tabs.Tab | null> => {
  if (typeof tabID === "number") {
    try {
      return await chrome.tabs.get(tabID);
    } catch {
      return null;
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
};

const refreshActionAppearance = async (tabID?: number): Promise<void> => {
  const [settings, tab] = await Promise.all([loadDialogSettings(), resolveTargetTab(tabID)]);
  const url = tab?.url ?? "";
  const scope = parseSiteScope(url) ?? "";
  const enabled = resolveDialogEnabledForURL(url, settings);
  await setActionAppearance(enabled, tab?.id, scope);
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

const listAnnotationsFromBackend = async (config: SyncConfig, url?: string): Promise<Annotation[] | null> => {
  if (!canUseBackendAnnotations(config)) {
    return null;
  }

  try {
    const path = url ? `/api/v1/annotations?url=${encodeURIComponent(url)}` : "/api/v1/annotations";
    const { response } = await fetchWithAuth(
      config,
      path,
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
): Promise<{ annotation: Annotation | null; shouldRetryFallback: boolean }> => {
  if (!canUseBackendAnnotations(config)) {
    return { annotation: null, shouldRetryFallback: true };
  }

  try {
    const { response } = await fetchWithAuth(
      config,
      `/api/v1/annotations/${encodeURIComponent(payload.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          url: payload.url,
          comment_text: payload.commentText,
          color: payload.color
        })
      }
    );
    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) {
        return { annotation: null, shouldRetryFallback: true };
      }
      return { annotation: null, shouldRetryFallback: false };
    }

    const body = (await response.json()) as ServerAnnotation;
    return { annotation: toLocalAnnotation(body), shouldRetryFallback: false };
  } catch {
    return { annotation: null, shouldRetryFallback: true };
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
  if (!config.enabled) {
    await chrome.storage.local.set({ [STORAGE_KEY.lastSyncError]: "sync disabled in settings" });
    return;
  }
  if (!config.apiBaseURL) {
    await chrome.storage.local.set({ [STORAGE_KEY.lastSyncError]: "sync skipped: API Base URL is empty" });
    return;
  }
  if (!config.accessToken) {
    await chrome.storage.local.set({ [STORAGE_KEY.lastSyncError]: "sync skipped: missing access token, please login" });
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

const runSync = (reason: string): Promise<void> => {
  if (syncInFlight) {
    return syncInFlight;
  }
  syncInFlight = syncNow(reason)
    .catch((error) => {
      const message = error instanceof Error ? error.message : "unknown sync error";
      void chrome.storage.local.set({ [STORAGE_KEY.lastSyncError]: message });
    })
    .finally(() => {
      syncInFlight = null;
    });
  return syncInFlight;
};

const scheduleSync = (reason: string): void => {
  void runSync(reason);
};

const handleList = async (url: string): Promise<Annotation[]> => {
  await ensureAnnotationURLMigration();
  const normalizedURL = normalizeAnnotationURL(url);
  if (!normalizedURL) {
    return [];
  }
  const config = await loadSyncConfig();
  const remoteAnnotations = await listAnnotationsFromBackend(config, normalizedURL);
  if (remoteAnnotations) {
    const [localAnnotations, pendingByURL] = await Promise.all([
      listAnnotations(normalizedURL),
      listPendingSyncStateByURL()
    ]);
    const reconciled = reconcileLocalWithRemote(localAnnotations, remoteAnnotations, pendingByURL.get(normalizedURL) ?? {
      pendingAnnotationIDs: new Set<string>(),
      pendingDeleteAnnotationIDs: new Set<string>()
    });
    await saveAnnotations(normalizedURL, reconciled);
    return reconciled;
  }
  return listAnnotations(normalizedURL);
};

const hydrateLocalAnnotationsFromBackend = async (): Promise<void> => {
  await ensureAnnotationURLMigration();
  const config = await loadSyncConfig();
  const remoteAnnotations = await listAnnotationsFromBackend(config);
  if (!remoteAnnotations) {
    return;
  }

  const groupedByURL = new Map<string, Annotation[]>();
  for (const annotation of remoteAnnotations) {
    const current = groupedByURL.get(annotation.url) ?? [];
    current.push(annotation);
    groupedByURL.set(annotation.url, current);
  }

  const [localURLs, pendingByURL] = await Promise.all([listLocalAnnotationURLs(), listPendingSyncStateByURL()]);
  const allURLs = new Set<string>([...localURLs, ...Array.from(groupedByURL.keys())]);

  for (const url of allURLs) {
    const localItems = await listAnnotations(url);
    const remoteItems = groupedByURL.get(url) ?? [];
    const reconciled = reconcileLocalWithRemote(localItems, remoteItems, pendingByURL.get(url) ?? {
      pendingAnnotationIDs: new Set<string>(),
      pendingDeleteAnnotationIDs: new Set<string>()
    });
    await saveAnnotations(url, reconciled);
  }
};

const listAnnotationURLSummaries = async (): Promise<AnnotationURLSummaryResponse> => {
  const storageData = await chrome.storage.local.get(null);
  const summaries: AnnotationURLSummary[] = [];

  for (const [key, value] of Object.entries(storageData)) {
    if (!key.startsWith("annotations:")) {
      continue;
    }

    const url = key.slice("annotations:".length).trim();
    if (!url || !Array.isArray(value)) {
      continue;
    }

    const annotations = (value as Annotation[]).filter((item) => item.status === "active");
    if (annotations.length === 0) {
      continue;
    }

    let latest = annotations[0];
    for (const item of annotations) {
      const latestTimestamp = Date.parse(latest.updatedAt || latest.createdAt || "");
      const itemTimestamp = Date.parse(item.updatedAt || item.createdAt || "");
      if (itemTimestamp > latestTimestamp) {
        latest = item;
      }
    }

    summaries.push({
      url,
      title: latest.title || url,
      count: annotations.length,
      updatedAt: latest.updatedAt || latest.createdAt || ""
    });
  }

  summaries.sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || "");
    const bTime = Date.parse(b.updatedAt || "");
    if (aTime !== bTime) {
      return bTime - aTime;
    }
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    return a.url.localeCompare(b.url);
  });

  return { summaries };
};

const handleCreate = async (payload: AnnotationCreateInput): Promise<Annotation> => {
  await ensureAnnotationURLMigration();
  const normalizedURL = normalizeAnnotationURL(payload.url);
  const normalizedPayload: AnnotationCreateInput = {
    ...payload,
    url: normalizedURL
  };
  const annotations = await listAnnotations(normalizedURL);
  const created = createAnnotation(normalizedPayload);
  annotations.push(created);
  await saveAnnotations(normalizedURL, annotations);
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

  await emitChanged(normalizedURL);
  return remoteCreated ?? created;
};

const handleUpdateComment = async (
  payload: AnnotationUpdateCommentInput
): Promise<Annotation | null> => {
  await ensureAnnotationURLMigration();
  const normalizedURL = normalizeAnnotationURL(payload.url);
  const normalizedPayload: AnnotationUpdateCommentInput = {
    ...payload,
    url: normalizedURL
  };
  const annotations = await listAnnotations(normalizedURL);
  const target = annotations.find((annotation) => annotation.id === payload.id);
  if (!target) {
    return null;
  }

  target.commentText = payload.commentText;
  if (typeof payload.color === "string" && payload.color.trim() !== "") {
    target.color = payload.color;
  }
  target.version += 1;
  target.updatedAt = nowISO();
  await saveAnnotations(normalizedURL, annotations);
  await prunePendingUpdateOperations(normalizedURL, payload.id);
  let resultAnnotation: Annotation = { ...target };
  const config = await loadSyncConfig();
  const remoteUpdateResult = await updateAnnotationCommentOnBackend(config, normalizedPayload);
  if (!remoteUpdateResult.annotation) {
    if (!remoteUpdateResult.shouldRetryFallback) {
      await emitChanged(normalizedURL);
      return resultAnnotation;
    }
    await enqueueOperation({
      opId: makeOperationID(),
      opType: "update_comment",
      url: normalizedURL,
      annotationId: payload.id,
      color: payload.color,
      commentText: payload.commentText,
      createdAt: nowISO(),
      lastError: ""
    });
    scheduleSync("annotation-update-comment-fallback");
  } else {
    const mergedRemoteUpdated: Annotation = {
      ...remoteUpdateResult.annotation,
      commentText: payload.commentText,
      color:
        typeof payload.color === "string" && payload.color.trim() !== ""
          ? payload.color
          : remoteUpdateResult.annotation.color
    };
    await upsertAnnotation(mergedRemoteUpdated);
    target.commentText = mergedRemoteUpdated.commentText;
    target.color = mergedRemoteUpdated.color;
    target.version = mergedRemoteUpdated.version;
    target.updatedAt = mergedRemoteUpdated.updatedAt;
    resultAnnotation = mergedRemoteUpdated;
  }

  await emitChanged(normalizedURL);
  return resultAnnotation;
};

const handleDelete = async (payload: AnnotationDeleteInput): Promise<boolean> => {
  await ensureAnnotationURLMigration();
  const normalizedURL = normalizeAnnotationURL(payload.url);
  const normalizedPayload: AnnotationDeleteInput = {
    ...payload,
    url: normalizedURL
  };
  const annotations = await listAnnotations(normalizedURL);
  const next = annotations.filter((annotation) => annotation.id !== payload.id);
  if (next.length === annotations.length) {
    return false;
  }

  await saveAnnotations(normalizedURL, next);
  await Promise.all([
    prunePendingUpdateOperations(normalizedURL, payload.id),
    prunePendingDeleteOperations(normalizedURL, payload.id)
  ]);
  const config = await loadSyncConfig();
  const deletedOnBackend = await deleteAnnotationOnBackend(config, normalizedPayload);
  await enqueueOperation({
    opId: makeOperationID(),
    opType: "delete",
    url: normalizedURL,
    annotationId: payload.id,
    createdAt: nowISO(),
    lastError: ""
  });
  scheduleSync(deletedOnBackend ? "annotation-delete-sync-event" : "annotation-delete-fallback");

  await emitChanged(normalizedURL);
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

  const normalizedFilterURL = url ? normalizeAnnotationURL(url) : "";
  const urlFilter = (value?: string): boolean =>
    normalizedFilterURL ? normalizeAnnotationURL(value ?? "") === normalizedFilterURL : true;
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
  void ensureDialogSettings().then(() => refreshActionAppearance()).catch(() => {
    // Ignore appearance init errors.
  });

  chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: 2
  });
});

chrome.runtime.onStartup.addListener(() => {
  void refreshActionAppearance().catch(() => {
    // Ignore appearance init errors.
  });
  chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: 2
  });
  scheduleSync("runtime-startup");
});

chrome.action.onClicked.addListener((tab) => {
  void (async () => {
    const url = tab.url ?? "";
    const scope = parseSiteScope(url);
    if (!scope) {
      await refreshActionAppearance(tab.id);
      return;
    }

    const settings = await loadDialogSettings();
    const current = resolveDialogEnabledForURL(url, settings);
    const next = !current;
    const nextSiteMap: DialogSiteMap = { ...settings.siteMap };
    if (next === settings.defaultEnabled) {
      delete nextSiteMap[scope];
    } else {
      nextSiteMap[scope] = next;
    }

    await chrome.storage.sync.set({ [STORAGE_KEY.dialogSiteMap]: nextSiteMap });
    await setActionAppearance(next, tab.id, scope);
  })();
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void refreshActionAppearance(activeInfo.tabId).catch(() => {
    // Ignore appearance refresh errors.
  });
});

chrome.tabs.onUpdated.addListener((tabID, changeInfo) => {
  if (changeInfo.status === "loading" || typeof changeInfo.url === "string") {
    void refreshActionAppearance(tabID).catch(() => {
      // Ignore appearance refresh errors.
    });
  }
});

chrome.windows.onFocusChanged.addListener((windowID) => {
  if (windowID === chrome.windows.WINDOW_ID_NONE) {
    return;
  }
  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, windowId: windowID });
    if (tab?.id != null) {
      await refreshActionAppearance(tab.id);
    }
  })();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") {
    return;
  }
  if (
    !changes[STORAGE_KEY.dialogDefaultEnabled] &&
    !changes[STORAGE_KEY.dialogSiteMap] &&
    !changes[STORAGE_KEY.legacyDialogEnabled]
  ) {
    return;
  }
  void refreshActionAppearance().catch(() => {
    // Ignore appearance refresh errors.
  });
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
        case "annotation.urls": {
          await hydrateLocalAnnotationsFromBackend();
          const result = await listAnnotationURLSummaries();
          sendResponse(ok<AnnotationURLSummaryResponse>(result));
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
          const reason = request.payload.reason ?? "manual";
          if (request.payload.wait) {
            await runSync(reason);
            sendResponse(ok({ scheduled: true, completed: true }));
            return;
          }
          scheduleSync(reason);
          sendResponse(ok({ scheduled: true, completed: false }));
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
        case "annotation.refreshAll":
        case "annotation.focus":
        case "annotation.editComment": {
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
