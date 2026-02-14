import React from "react";
import { createRoot } from "react-dom/client";
import type { Annotation } from "@/shared/annotation";
import type { AnnotationChangedEvent, AnnotationListResponse } from "@/shared/messages";
import type { SyncConflictItem } from "@/shared/sync";
import { sendRuntimeMessage } from "@/lib/runtime";
import "./styles.css";

const PAGE_SIZE_OPTIONS = [5, 10, 20] as const;

const getActiveTabContext = async (): Promise<{ tabId: number | null; url: string }> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return {
    tabId: tab?.id ?? null,
    url: tab?.url ?? ""
  };
};

type SyncPanelState = {
  queueLength: number;
  conflictCount: number;
  pendingAnnotationIDs: string[];
  conflictAnnotationIDs: string[];
  conflictOpIDs: string[];
  conflictOpIDsByAnnotationID: Record<string, string[]>;
  lastSyncAt: string;
  lastSyncError: string;
};

type SyncConflictListResponse = {
  conflicts: SyncConflictItem[];
  queueLength: number;
  lastSyncAt: string;
  lastSyncError: string;
};

type TabRuntimeRequest =
  | { type: "annotation.focus"; payload: { id: string } }
  | { type: "annotation.editComment"; payload: { id: string; url?: string } }
  | { type: "annotation.refresh"; payload: { url: string } };

const DEFAULT_SYNC_STATE: SyncPanelState = {
  queueLength: 0,
  conflictCount: 0,
  pendingAnnotationIDs: [],
  conflictAnnotationIDs: [],
  conflictOpIDs: [],
  conflictOpIDsByAnnotationID: {},
  lastSyncAt: "",
  lastSyncError: ""
};

function SidePanelApp(): JSX.Element {
  const [url, setURL] = React.useState("");
  const [tabID, setTabID] = React.useState<number | null>(null);
  const [annotations, setAnnotations] = React.useState<Annotation[]>([]);
  const [syncState, setSyncState] = React.useState<SyncPanelState>(DEFAULT_SYNC_STATE);
  const [pageConflicts, setPageConflicts] = React.useState<SyncConflictItem[]>([]);
  const [showConflictPanel, setShowConflictPanel] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [syncNowPending, setSyncNowPending] = React.useState(false);

  const reloadConflictDetails = React.useCallback(
    async (targetURL?: string) => {
      const nextURL = targetURL ?? url;
      if (!nextURL) {
        setPageConflicts([]);
        return;
      }

      try {
        const result = await sendRuntimeMessage<SyncConflictListResponse>({
          type: "sync.conflicts.list",
          payload: {}
        });
        setPageConflicts(result.conflicts.filter((item) => item.operation.url === nextURL));
      } catch {
        // Ignore conflict list load errors in panel.
      }
    },
    [url]
  );

  const reloadSyncState = React.useCallback(
    async (targetURL?: string) => {
      const nextURL = targetURL ?? url;
      if (!nextURL) {
        setSyncState(DEFAULT_SYNC_STATE);
        return;
      }

      try {
        const result = await sendRuntimeMessage<SyncPanelState>({
          type: "sync.state",
          payload: { url: nextURL }
        });
        setSyncState(result);
      } catch {
        // Ignore sync state load errors in panel.
      }

      await reloadConflictDetails(nextURL);
    },
    [reloadConflictDetails, url]
  );

  const reload = React.useCallback(
    async (targetURL?: string) => {
      const nextURL = targetURL ?? url;
      if (!nextURL) {
        setAnnotations([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const result = await sendRuntimeMessage<AnnotationListResponse>({
          type: "annotation.list",
          payload: { url: nextURL }
        });
        setAnnotations(result.annotations);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "加载失败");
      } finally {
        setLoading(false);
      }

      await reloadSyncState(nextURL);
    },
    [reloadSyncState, url]
  );

  const refreshActiveTab = React.useCallback(async (): Promise<void> => {
    const tabContext = await getActiveTabContext();
    setURL(tabContext.url);
    setTabID(tabContext.tabId);
    await reload(tabContext.url);
  }, [reload]);

  React.useEffect(() => {
    void refreshActiveTab();
  }, [refreshActiveTab]);

  React.useEffect(() => {
    const onActivated = (): void => {
      void refreshActiveTab();
    };

    const onUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab): void => {
      if (!tab.active) {
        return;
      }
      if (typeof changeInfo.url === "string" || changeInfo.status === "complete") {
        void refreshActiveTab();
      }
    };

    const onWindowFocusChanged = (windowID: number): void => {
      if (windowID === chrome.windows.WINDOW_ID_NONE) {
        return;
      }
      void refreshActiveTab();
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(onWindowFocusChanged);

    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(onWindowFocusChanged);
    };
  }, [refreshActiveTab]);

  React.useEffect(() => {
    const listener = (message: AnnotationChangedEvent): void => {
      if (message.type === "annotation.changed" && message.payload.url === url) {
        void reload(url);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [reload, url]);

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      void reloadSyncState();
    }, 6000);

    return () => window.clearInterval(interval);
  }, [reloadSyncState]);

  React.useEffect(() => {
    setPage(1);
  }, [url, pageSize]);

  const sendMessageToActiveTab = React.useCallback(
    async (message: TabRuntimeRequest): Promise<boolean> => {
      if (tabID === null) {
        setError("当前标签页不可用");
        return false;
      }

      try {
        await chrome.tabs.sendMessage(tabID, message);
        return true;
      } catch (sendError) {
        const messageText =
          sendError instanceof Error && sendError.message
            ? sendError.message
            : "当前页面暂不支持该操作，请刷新网页后重试";
        setError(messageText);
        return false;
      }
    },
    [tabID]
  );

  const onFocus = async (id: string): Promise<void> => {
    setError("");
    await sendMessageToActiveTab({
      type: "annotation.focus",
      payload: { id }
    });
  };

  const onEdit = async (annotation: Annotation): Promise<void> => {
    setError("");
    await sendMessageToActiveTab({
      type: "annotation.editComment",
      payload: { id: annotation.id, url }
    });
  };

  const onDelete = async (annotation: Annotation): Promise<void> => {
    setError("");
    try {
      await sendRuntimeMessage({
        type: "annotation.delete",
        payload: { url, id: annotation.id }
      });
      await reload();
      await sendMessageToActiveTab({
        type: "annotation.refresh",
        payload: { url }
      });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除失败");
    }
  };

  const onSyncNow = async (): Promise<void> => {
    if (syncNowPending) {
      return;
    }
    setSyncNowPending(true);
    try {
      await sendRuntimeMessage({ type: "sync.now", payload: { reason: "sidepanel", wait: true } });
      await reload();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "同步失败");
    } finally {
      setSyncNowPending(false);
    }
  };

  const openLoginSettings = async (): Promise<void> => {
    try {
      await chrome.runtime.openOptionsPage();
    } catch {
      await chrome.tabs.create({ url: chrome.runtime.getURL("src/options/index.html") });
    }
  };

  const openLibraryPage = async (): Promise<void> => {
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/options/index.html#library") });
  };

  const onRetryPageConflicts = async (): Promise<void> => {
    if (syncState.conflictOpIDs.length === 0) {
      return;
    }
    setError("");
    try {
      await sendRuntimeMessage({
        type: "sync.conflicts.retry",
        payload: { opIds: syncState.conflictOpIDs }
      });
      await sendRuntimeMessage({ type: "sync.now", payload: { reason: "sidepanel-retry-page-conflicts", wait: true } });
      await reloadSyncState();
      await reload();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "重试冲突失败");
    }
  };

  const onRetryAnnotationConflicts = async (annotationID: string): Promise<void> => {
    const opIDs = syncState.conflictOpIDsByAnnotationID[annotationID] ?? [];
    if (opIDs.length === 0) {
      return;
    }
    setError("");
    try {
      await sendRuntimeMessage({
        type: "sync.conflicts.retry",
        payload: { opIds: opIDs }
      });
      await sendRuntimeMessage({ type: "sync.now", payload: { reason: "sidepanel-retry-annotation-conflicts", wait: true } });
      await reloadSyncState();
      await reload();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "重试该条冲突失败");
    }
  };

  const onRetrySingleConflict = async (opID: string): Promise<void> => {
    setError("");
    try {
      await sendRuntimeMessage({ type: "sync.conflicts.retry", payload: { opIds: [opID] } });
      await sendRuntimeMessage({ type: "sync.now", payload: { reason: "sidepanel-retry-single-conflict", wait: true } });
      await reloadSyncState();
      await reload();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "重试冲突失败");
    }
  };

  const onIgnoreSingleConflict = async (opID: string): Promise<void> => {
    setError("");
    try {
      await sendRuntimeMessage({ type: "sync.conflicts.remove", payload: { opIds: [opID] } });
      await reloadSyncState();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "忽略冲突失败");
    }
  };

  const onIgnorePageConflicts = async (): Promise<void> => {
    if (syncState.conflictOpIDs.length === 0) {
      return;
    }
    setError("");
    try {
      await sendRuntimeMessage({
        type: "sync.conflicts.remove",
        payload: { opIds: syncState.conflictOpIDs }
      });
      await reloadSyncState();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "忽略冲突失败");
    }
  };

  const onRetryConflictGroup = async (message: string): Promise<void> => {
    const opIDs = pageConflicts.filter((item) => item.message === message).map((item) => item.opId);
    if (opIDs.length === 0) {
      return;
    }
    setError("");
    try {
      await sendRuntimeMessage({ type: "sync.conflicts.retry", payload: { opIds: opIDs } });
      await sendRuntimeMessage({ type: "sync.now", payload: { reason: "sidepanel-retry-conflict-group", wait: true } });
      await reloadSyncState();
      await reload();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "重试同类冲突失败");
    }
  };

  const onIgnoreConflictGroup = async (message: string): Promise<void> => {
    const opIDs = pageConflicts.filter((item) => item.message === message).map((item) => item.opId);
    if (opIDs.length === 0) {
      return;
    }
    setError("");
    try {
      await sendRuntimeMessage({ type: "sync.conflicts.remove", payload: { opIds: opIDs } });
      await reloadSyncState();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "忽略同类冲突失败");
    }
  };

  const pendingSet = React.useMemo(() => new Set(syncState.pendingAnnotationIDs), [syncState.pendingAnnotationIDs]);
  const conflictSet = React.useMemo(
    () => new Set(syncState.conflictAnnotationIDs),
    [syncState.conflictAnnotationIDs]
  );
  const pendingVisibleCount = React.useMemo(
    () => annotations.filter((item) => pendingSet.has(item.id)).length,
    [annotations, pendingSet]
  );
  const conflictGroups = React.useMemo(() => {
    const groups = new Map<string, SyncConflictItem[]>();
    for (const item of pageConflicts) {
      const key = item.message || "unknown";
      const existing = groups.get(key) ?? [];
      existing.push(item);
      groups.set(key, existing);
    }
    return Array.from(groups.entries()).map(([message, items]) => ({ message, items }));
  }, [pageConflicts]);

  const totalPages = React.useMemo(() => {
    if (annotations.length === 0) {
      return 1;
    }
    return Math.ceil(annotations.length / pageSize);
  }, [annotations.length, pageSize]);

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pagedAnnotations = React.useMemo(() => {
    const start = (page - 1) * pageSize;
    return annotations.slice(start, start + pageSize);
  }, [annotations, page, pageSize]);

  return (
    <main className="sp-root">
      <header className="sp-header">
        <h2 className="sp-title">页面高亮与评论</h2>
        <div className="sp-header-actions">
          <button className="sp-btn sp-btn-header" onClick={() => void openLoginSettings()}>
            登录设置
          </button>
          <button className="sp-btn sp-btn-header" onClick={() => void openLibraryPage()}>
            我的划词库
          </button>
        </div>
        <div className="sp-url-card">
          <div className="sp-url-label">当前页面</div>
          {url ? (
            <a className="sp-url-link" href={url} title={url} target="_blank" rel="noreferrer">
              {url}
            </a>
          ) : (
            <p className="sp-url-empty">当前标签页无 URL</p>
          )}
        </div>
      </header>

      <section className="sp-sync-card">
        <div className="sp-sync-top">
          <div className="sp-sync-metrics">
            <span className="sp-metric">待同步高亮: {pendingVisibleCount}</span>
            <span className="sp-metric">待同步操作: {syncState.queueLength}</span>
            <span className={`sp-metric ${syncState.conflictCount > 0 ? "sp-metric-danger" : ""}`}>
              冲突: {syncState.conflictCount}
            </span>
          </div>
          <button className="sp-btn sp-btn-primary sp-sync-now" onClick={() => void onSyncNow()} disabled={syncNowPending}>
            {syncNowPending ? "同步中..." : "立即同步"}
          </button>
        </div>
        <div className="sp-sync-actions">
          <button className="sp-btn" onClick={() => void onRetryPageConflicts()} disabled={syncState.conflictOpIDs.length === 0}>
            重试本页冲突
          </button>
          <button className="sp-btn" onClick={() => void setShowConflictPanel((current) => !current)} disabled={pageConflicts.length === 0}>
            {showConflictPanel ? "隐藏冲突详情" : "查看冲突详情"}
          </button>
        </div>
        <div className="sp-subtext">上次同步: {syncState.lastSyncAt || "-"}</div>
        {syncState.lastSyncError ? <div className="sp-error-text">错误: {syncState.lastSyncError}</div> : null}
      </section>

      {showConflictPanel ? (
        <section className="sp-conflict-card">
          <div className="sp-conflict-head">
            <div className="sp-conflict-title">本页冲突详情 ({pageConflicts.length})</div>
            <button className="sp-btn sp-btn-danger" onClick={() => void onIgnorePageConflicts()} disabled={pageConflicts.length === 0}>
              忽略本页全部冲突
            </button>
          </div>
          {pageConflicts.length === 0 ? <div className="sp-subtext">无冲突明细</div> : null}
          {conflictGroups.length > 0 ? (
            <div className="sp-conflict-groups">
              <div className="sp-subtext">按错误类型分组</div>
              {conflictGroups.map((group) => (
                <div key={group.message} className="sp-conflict-group-item">
                  <div className="sp-conflict-message">
                    {group.message} ({group.items.length})
                  </div>
                  <div className="sp-actions">
                    <button className="sp-btn sp-btn-danger" onClick={() => void onRetryConflictGroup(group.message)}>
                      重试同类
                    </button>
                    <button className="sp-btn sp-btn-danger" onClick={() => void onIgnoreConflictGroup(group.message)}>
                      忽略同类
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {pageConflicts.map((conflict) => (
            <article key={`${conflict.opId}-${conflict.createdAt}`} className="sp-conflict-item">
              <div className="sp-subtext">op_id: {conflict.opId}</div>
              <div className="sp-subtext">type: {conflict.operation.opType}</div>
              <div className="sp-subtext">annotation: {conflict.operation.annotationId || "(none)"}</div>
              <div className="sp-conflict-message">{conflict.message}</div>
              <div className="sp-actions">
                <button className="sp-btn sp-btn-danger" onClick={() => void onRetrySingleConflict(conflict.opId)}>
                  重试此冲突
                </button>
                <button className="sp-btn sp-btn-danger" onClick={() => void onIgnoreSingleConflict(conflict.opId)}>
                  忽略此冲突
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {loading ? <p className="sp-subtext">加载中...</p> : null}
      {error ? <p className="sp-error-text">{error}</p> : null}

      {!loading && annotations.length > 0 ? (
        <section className="sp-pagination-bar">
          <span className="sp-subtext">共 {annotations.length} 条</span>
          <label className="sp-page-size">
            每页
            <select
              className="sp-select"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <div className="sp-pagination-controls">
            <button className="sp-btn" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>
              上一页
            </button>
            <span className="sp-subtext">
              第 {page}/{totalPages} 页
            </span>
            <button
              className="sp-btn"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
            >
              下一页
            </button>
          </div>
        </section>
      ) : null}

      {!loading && annotations.length === 0 ? <p className="sp-subtext">暂无高亮，先去页面划词试试。</p> : null}
      {pagedAnnotations.map((annotation) => {
        const isConflict = conflictSet.has(annotation.id);
        const isPending = pendingSet.has(annotation.id);

        return (
          <article key={annotation.id} className="sp-card">
            <div className="sp-card-head">
              <div
                className="sp-quote"
                style={
                  {
                    "--sp-quote-color": annotation.color
                  } as React.CSSProperties
                }
              >
                {annotation.quoteText}
              </div>
              {isConflict ? <span className="sp-badge sp-badge-conflict">冲突</span> : null}
              {!isConflict && isPending ? <span className="sp-badge sp-badge-pending">待同步</span> : null}
              {!isConflict && !isPending ? <span className="sp-badge sp-badge-success">已同步</span> : null}
            </div>
            <p className="sp-comment">{annotation.commentText || "(无评论)"}</p>
            <div className="sp-actions">
              <button className="sp-btn" onClick={() => void onFocus(annotation.id)}>
                定位
              </button>
              {isConflict ? (
                <button className="sp-btn sp-btn-danger" onClick={() => void onRetryAnnotationConflicts(annotation.id)}>
                  重试该条冲突
                </button>
              ) : null}
              <button className="sp-btn" onClick={() => void onEdit(annotation)}>
                编辑评论
              </button>
              <button className="sp-btn" onClick={() => void onDelete(annotation)}>
                删除
              </button>
            </div>
          </article>
        );
      })}

    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SidePanelApp />
  </React.StrictMode>
);
