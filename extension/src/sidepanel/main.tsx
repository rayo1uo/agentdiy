import React from "react";
import { createRoot } from "react-dom/client";
import type { Annotation } from "@/shared/annotation";
import type { AnnotationChangedEvent, AnnotationListResponse } from "@/shared/messages";
import type { SyncConflictItem } from "@/shared/sync";
import { sendRuntimeMessage } from "@/lib/runtime";

const containerStyle: React.CSSProperties = {
  fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  padding: 14,
  color: "#0f172a"
};

const cardStyle: React.CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: 12,
  marginBottom: 10,
  background: "#ffffff"
};

const buttonStyle: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  background: "#f8fafc",
  padding: "6px 8px",
  cursor: "pointer",
  fontSize: 12
};

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
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

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

  React.useEffect(() => {
    void (async () => {
      const tabContext = await getActiveTabContext();
      setURL(tabContext.url);
      setTabID(tabContext.tabId);
      await reload(tabContext.url);
    })();
  }, [reload]);

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

  const onFocus = async (id: string): Promise<void> => {
    if (!tabID) {
      return;
    }

    await chrome.tabs.sendMessage(tabID, {
      type: "annotation.focus",
      payload: { id }
    });
  };

  const onEdit = async (annotation: Annotation): Promise<void> => {
    const value = window.prompt("编辑评论", annotation.commentText) ?? annotation.commentText;
    await sendRuntimeMessage({
      type: "annotation.updateComment",
      payload: { url, id: annotation.id, commentText: value }
    });
    await reload();
    if (tabID) {
      await chrome.tabs.sendMessage(tabID, {
        type: "annotation.refresh",
        payload: { url }
      });
    }
  };

  const onDelete = async (annotation: Annotation): Promise<void> => {
    await sendRuntimeMessage({
      type: "annotation.delete",
      payload: { url, id: annotation.id }
    });
    await reload();
    if (tabID) {
      await chrome.tabs.sendMessage(tabID, {
        type: "annotation.refresh",
        payload: { url }
      });
    }
  };

  const onSyncNow = async (): Promise<void> => {
    await sendRuntimeMessage({ type: "sync.now", payload: { reason: "sidepanel" } });
    await reloadSyncState();
  };

  const onRetryPageConflicts = async (): Promise<void> => {
    if (syncState.conflictOpIDs.length === 0) {
      return;
    }
    await sendRuntimeMessage({
      type: "sync.conflicts.retry",
      payload: { opIds: syncState.conflictOpIDs }
    });
    await sendRuntimeMessage({ type: "sync.now", payload: { reason: "sidepanel-retry-page-conflicts" } });
    await reloadSyncState();
    await reload();
  };

  const onRetryAnnotationConflicts = async (annotationID: string): Promise<void> => {
    const opIDs = syncState.conflictOpIDsByAnnotationID[annotationID] ?? [];
    if (opIDs.length === 0) {
      return;
    }
    await sendRuntimeMessage({
      type: "sync.conflicts.retry",
      payload: { opIds: opIDs }
    });
    await sendRuntimeMessage({ type: "sync.now", payload: { reason: "sidepanel-retry-annotation-conflicts" } });
    await reloadSyncState();
    await reload();
  };

  const onRetrySingleConflict = async (opID: string): Promise<void> => {
    await sendRuntimeMessage({ type: "sync.conflicts.retry", payload: { opIds: [opID] } });
    await sendRuntimeMessage({ type: "sync.now", payload: { reason: "sidepanel-retry-single-conflict" } });
    await reloadSyncState();
    await reload();
  };

  const onIgnoreSingleConflict = async (opID: string): Promise<void> => {
    await sendRuntimeMessage({ type: "sync.conflicts.remove", payload: { opIds: [opID] } });
    await reloadSyncState();
  };

  const onIgnorePageConflicts = async (): Promise<void> => {
    if (syncState.conflictOpIDs.length === 0) {
      return;
    }
    await sendRuntimeMessage({
      type: "sync.conflicts.remove",
      payload: { opIds: syncState.conflictOpIDs }
    });
    await reloadSyncState();
  };

  const onRetryConflictGroup = async (message: string): Promise<void> => {
    const opIDs = pageConflicts.filter((item) => item.message === message).map((item) => item.opId);
    if (opIDs.length === 0) {
      return;
    }
    await sendRuntimeMessage({ type: "sync.conflicts.retry", payload: { opIds: opIDs } });
    await sendRuntimeMessage({ type: "sync.now", payload: { reason: "sidepanel-retry-conflict-group" } });
    await reloadSyncState();
    await reload();
  };

  const onIgnoreConflictGroup = async (message: string): Promise<void> => {
    const opIDs = pageConflicts.filter((item) => item.message === message).map((item) => item.opId);
    if (opIDs.length === 0) {
      return;
    }
    await sendRuntimeMessage({ type: "sync.conflicts.remove", payload: { opIds: opIDs } });
    await reloadSyncState();
  };

  const pendingSet = React.useMemo(() => new Set(syncState.pendingAnnotationIDs), [syncState.pendingAnnotationIDs]);
  const conflictSet = React.useMemo(
    () => new Set(syncState.conflictAnnotationIDs),
    [syncState.conflictAnnotationIDs]
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

  return (
    <main style={containerStyle}>
      <h2 style={{ margin: 0, fontSize: 18 }}>页面高亮与评论</h2>
      <p style={{ marginTop: 8, color: "#475569", fontSize: 12, wordBreak: "break-all" }}>{url || "当前标签页无 URL"}</p>

      <section style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#334155" }}>待同步: {syncState.queueLength}</span>
          <span style={{ fontSize: 12, color: syncState.conflictCount > 0 ? "#b91c1c" : "#334155" }}>
            冲突: {syncState.conflictCount}
          </span>
          <button
            style={{ ...buttonStyle }}
            onClick={() => void onRetryPageConflicts()}
            disabled={syncState.conflictOpIDs.length === 0}
          >
            重试本页冲突
          </button>
          <button
            style={{ ...buttonStyle }}
            onClick={() => void setShowConflictPanel((current) => !current)}
            disabled={pageConflicts.length === 0}
          >
            {showConflictPanel ? "隐藏冲突详情" : "查看冲突详情"}
          </button>
          <button style={{ ...buttonStyle, marginLeft: "auto" }} onClick={() => void onSyncNow()}>
            立即同步
          </button>
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "#64748b" }}>上次同步: {syncState.lastSyncAt || "-"}</div>
        {syncState.lastSyncError ? (
          <div style={{ marginTop: 4, fontSize: 11, color: "#b91c1c" }}>错误: {syncState.lastSyncError}</div>
        ) : null}
      </section>

      {showConflictPanel ? (
        <section style={{ border: "1px solid #fecaca", borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: "#991b1b" }}>本页冲突详情 ({pageConflicts.length})</div>
            <button
              style={{ ...buttonStyle, borderColor: "#fca5a5", color: "#991b1b", marginLeft: "auto" }}
              onClick={() => void onIgnorePageConflicts()}
              disabled={pageConflicts.length === 0}
            >
              忽略本页全部冲突
            </button>
          </div>
          {pageConflicts.length === 0 ? <div style={{ fontSize: 12, color: "#64748b" }}>无冲突明细</div> : null}
          {conflictGroups.length > 0 ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>按错误类型分组</div>
              {conflictGroups.map((group) => (
                <div
                  key={group.message}
                  style={{ border: "1px dashed #fecaca", borderRadius: 8, padding: 8, marginBottom: 6 }}
                >
                  <div style={{ fontSize: 12, color: "#991b1b" }}>
                    {group.message} ({group.items.length})
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button
                      style={{ ...buttonStyle, borderColor: "#fecaca", color: "#991b1b" }}
                      onClick={() => void onRetryConflictGroup(group.message)}
                    >
                      重试同类
                    </button>
                    <button
                      style={{ ...buttonStyle, borderColor: "#fecaca", color: "#991b1b" }}
                      onClick={() => void onIgnoreConflictGroup(group.message)}
                    >
                      忽略同类
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {pageConflicts.map((conflict) => (
            <article
              key={`${conflict.opId}-${conflict.createdAt}`}
              style={{ border: "1px solid #fee2e2", borderRadius: 8, padding: 8, marginBottom: 6, background: "#fff1f2" }}
            >
              <div style={{ fontSize: 12, color: "#334155" }}>op_id: {conflict.opId}</div>
              <div style={{ fontSize: 12, color: "#334155" }}>type: {conflict.operation.opType}</div>
              <div style={{ fontSize: 12, color: "#334155" }}>
                annotation: {conflict.operation.annotationId || "(none)"}
              </div>
              <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 4 }}>{conflict.message}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button
                  style={{ ...buttonStyle, borderColor: "#fecaca", color: "#991b1b" }}
                  onClick={() => void onRetrySingleConflict(conflict.opId)}
                >
                  重试此冲突
                </button>
                <button
                  style={{ ...buttonStyle, borderColor: "#fecaca", color: "#991b1b" }}
                  onClick={() => void onIgnoreSingleConflict(conflict.opId)}
                >
                  忽略此冲突
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {loading ? <p>加载中...</p> : null}
      {error ? <p style={{ color: "#dc2626" }}>{error}</p> : null}
      {!loading && annotations.length === 0 ? <p>暂无高亮，先去页面划词试试。</p> : null}
      {annotations.map((annotation) => {
        const isConflict = conflictSet.has(annotation.id);
        const isPending = pendingSet.has(annotation.id);

        return (
          <article key={annotation.id} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontWeight: 600, lineHeight: 1.4, flex: 1 }}>{annotation.quoteText}</div>
              {isConflict ? (
                <span style={{ fontSize: 11, color: "#fff", background: "#b91c1c", padding: "2px 6px", borderRadius: 999 }}>
                  冲突
                </span>
              ) : null}
              {!isConflict && isPending ? (
                <span style={{ fontSize: 11, color: "#0c4a6e", background: "#bfdbfe", padding: "2px 6px", borderRadius: 999 }}>
                  待同步
                </span>
              ) : null}
              {!isConflict && !isPending ? (
                <span style={{ fontSize: 11, color: "#166534", background: "#bbf7d0", padding: "2px 6px", borderRadius: 999 }}>
                  已同步
                </span>
              ) : null}
            </div>
            <p style={{ color: "#475569", marginBottom: 8, marginTop: 8 }}>{annotation.commentText || "(无评论)"}</p>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={buttonStyle} onClick={() => void onFocus(annotation.id)}>
                定位
              </button>
              {isConflict ? (
                <button
                  style={{ ...buttonStyle, borderColor: "#fca5a5", color: "#b91c1c" }}
                  onClick={() => void onRetryAnnotationConflicts(annotation.id)}
                >
                  重试该条冲突
                </button>
              ) : null}
              <button style={buttonStyle} onClick={() => void onEdit(annotation)}>
                编辑评论
              </button>
              <button style={buttonStyle} onClick={() => void onDelete(annotation)}>
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
