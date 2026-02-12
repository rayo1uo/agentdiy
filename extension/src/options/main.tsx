import React from "react";
import { createRoot } from "react-dom/client";
import { sendRuntimeMessage } from "@/lib/runtime";
import type { Annotation } from "@/shared/annotation";
import type {
  AnnotationListResponse,
  AnnotationURLSummary,
  AnnotationURLSummaryResponse
} from "@/shared/messages";
import type { SyncConflictItem } from "@/shared/sync";

const SETTINGS_KEY_SYNC_ENABLED = "settings:syncEnabled";
const SETTINGS_KEY_API_BASE = "settings:apiBaseUrl";
const AUTH_KEY_ACCESS_TOKEN = "auth:accessToken";
const AUTH_KEY_REFRESH_TOKEN = "auth:refreshToken";

type OptionsTab = "settings" | "library";

type SyncStatus = {
  conflicts: SyncConflictItem[];
  queueLength: number;
  lastSyncAt: string;
  lastSyncError: string;
};

const parseTabFromHash = (): OptionsTab =>
  window.location.hash.replace("#", "") === "library" ? "library" : "settings";

const formatTimestamp = (value: string): string => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
};

function OptionsApp(): JSX.Element {
  const [activeTab, setActiveTab] = React.useState<OptionsTab>(parseTabFromHash());
  const [syncEnabled, setSyncEnabled] = React.useState(true);
  const [apiBaseURL, setAPIBaseURL] = React.useState("http://localhost:8080");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [authMessage, setAuthMessage] = React.useState("");
  const [accessToken, setAccessToken] = React.useState("");
  const [refreshToken, setRefreshToken] = React.useState("");
  const [saved, setSaved] = React.useState(false);
  const [syncStatus, setSyncStatus] = React.useState<SyncStatus>({
    conflicts: [],
    queueLength: 0,
    lastSyncAt: "",
    lastSyncError: ""
  });
  const [urlSummaries, setURLSummaries] = React.useState<AnnotationURLSummary[]>([]);
  const [selectedURL, setSelectedURL] = React.useState("");
  const [selectedAnnotations, setSelectedAnnotations] = React.useState<Annotation[]>([]);
  const [libraryLoading, setLibraryLoading] = React.useState(false);
  const [libraryError, setLibraryError] = React.useState("");

  const loadSyncStatus = React.useCallback(async () => {
    const status = await sendRuntimeMessage<SyncStatus>({ type: "sync.conflicts.list", payload: {} });
    setSyncStatus(status);
  }, []);

  const loadURLSummaries = React.useCallback(
    async (keepSelection = true): Promise<void> => {
      const response = await sendRuntimeMessage<AnnotationURLSummaryResponse>({
        type: "annotation.urls",
        payload: {}
      });
      setURLSummaries(response.summaries);
      setSelectedURL((current) => {
        if (keepSelection && current && response.summaries.some((item) => item.url === current)) {
          return current;
        }
        return response.summaries[0]?.url ?? "";
      });
    },
    []
  );

  const loadAnnotationsByURL = React.useCallback(async (url: string): Promise<void> => {
    if (!url) {
      setSelectedAnnotations([]);
      return;
    }

    setLibraryLoading(true);
    setLibraryError("");
    try {
      const response = await sendRuntimeMessage<AnnotationListResponse>({
        type: "annotation.list",
        payload: { url }
      });
      setSelectedAnnotations(response.annotations);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "加载划词失败");
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const onHashChange = (): void => {
      setActiveTab(parseTabFromHash());
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  React.useEffect(() => {
    void (async () => {
      const [syncData, localData] = await Promise.all([
        chrome.storage.sync.get([SETTINGS_KEY_SYNC_ENABLED, SETTINGS_KEY_API_BASE]),
        chrome.storage.local.get([AUTH_KEY_ACCESS_TOKEN, AUTH_KEY_REFRESH_TOKEN])
      ]);

      if (typeof syncData[SETTINGS_KEY_SYNC_ENABLED] === "boolean") {
        setSyncEnabled(syncData[SETTINGS_KEY_SYNC_ENABLED] as boolean);
      }

      if (typeof syncData[SETTINGS_KEY_API_BASE] === "string") {
        setAPIBaseURL(syncData[SETTINGS_KEY_API_BASE] as string);
      }

      if (typeof localData[AUTH_KEY_ACCESS_TOKEN] === "string") {
        setAccessToken(localData[AUTH_KEY_ACCESS_TOKEN] as string);
      }

      if (typeof localData[AUTH_KEY_REFRESH_TOKEN] === "string") {
        setRefreshToken(localData[AUTH_KEY_REFRESH_TOKEN] as string);
      }

      await Promise.all([loadSyncStatus(), loadURLSummaries(false)]);
    })();
  }, [loadSyncStatus, loadURLSummaries]);

  React.useEffect(() => {
    void loadAnnotationsByURL(selectedURL);
  }, [loadAnnotationsByURL, selectedURL]);

  const switchTab = (tab: OptionsTab): void => {
    setActiveTab(tab);
    window.location.hash = tab === "library" ? "library" : "settings";
  };

  const onSave = async (): Promise<void> => {
    await Promise.all([
      chrome.storage.sync.set({
        [SETTINGS_KEY_SYNC_ENABLED]: syncEnabled,
        [SETTINGS_KEY_API_BASE]: apiBaseURL.trim()
      }),
      chrome.storage.local.set({
        [AUTH_KEY_ACCESS_TOKEN]: accessToken.trim(),
        [AUTH_KEY_REFRESH_TOKEN]: refreshToken.trim()
      })
    ]);

    await sendRuntimeMessage({ type: "sync.now", payload: { reason: "settings-save" } });

    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
    await loadSyncStatus();
  };

  const authByEndpoint = async (endpoint: "/register" | "/login"): Promise<void> => {
    const baseURL = apiBaseURL.trim().replace(/\/+$/, "");
    if (!baseURL || !email.trim() || !password.trim()) {
      setAuthMessage("请先填写 API 地址、邮箱、密码");
      return;
    }

    setAuthMessage("认证中...");
    const response = await fetch(`${baseURL}/api/v1/auth${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        password: password.trim()
      })
    });

    if (!response.ok) {
      const text = await response.text();
      setAuthMessage(`认证失败(${response.status}): ${text}`);
      return;
    }

    const data = (await response.json()) as {
      token_pair?: { access_token?: string; refresh_token?: string };
    };
    const nextAccess = data.token_pair?.access_token ?? "";
    const nextRefresh = data.token_pair?.refresh_token ?? "";
    if (!nextAccess || !nextRefresh) {
      setAuthMessage("认证响应缺少 token");
      return;
    }

    await chrome.storage.local.set({
      [AUTH_KEY_ACCESS_TOKEN]: nextAccess,
      [AUTH_KEY_REFRESH_TOKEN]: nextRefresh
    });
    setAccessToken(nextAccess);
    setRefreshToken(nextRefresh);
    setAuthMessage("认证成功，token 已写入");
    await sendRuntimeMessage({ type: "sync.now", payload: { reason: "auth-success" } });
    await Promise.all([loadSyncStatus(), loadURLSummaries(false)]);
  };

  const onLogout = async (): Promise<void> => {
    const baseURL = apiBaseURL.trim().replace(/\/+$/, "");
    if (baseURL && refreshToken.trim()) {
      try {
        await fetch(`${baseURL}/api/v1/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken.trim() })
        });
      } catch {
        // Ignore network errors; local token cleanup still proceeds.
      }
    }

    await chrome.storage.local.set({
      [AUTH_KEY_ACCESS_TOKEN]: "",
      [AUTH_KEY_REFRESH_TOKEN]: ""
    });
    setAccessToken("");
    setRefreshToken("");
    setAuthMessage("已退出登录并清理本地 token");
    await Promise.all([loadSyncStatus(), loadURLSummaries(false)]);
  };

  const onRetryConflicts = async (): Promise<void> => {
    await sendRuntimeMessage({ type: "sync.conflicts.retry", payload: {} });
    await loadSyncStatus();
  };

  return (
    <main
      style={{
        margin: "24px auto",
        maxWidth: 980,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        color: "#0f172a"
      }}
    >
      <h1 style={{ marginBottom: 10 }}>Annota 控制台</h1>
      <p style={{ marginTop: 0, color: "#475569" }}>登录、同步配置与当前用户划词评论总览。</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          style={{
            border: activeTab === "settings" ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
            background: activeTab === "settings" ? "#eff6ff" : "#fff",
            color: "#0f172a",
            borderRadius: 8,
            padding: "8px 12px",
            cursor: "pointer",
            fontWeight: 700
          }}
          onClick={() => switchTab("settings")}
        >
          登录与同步设置
        </button>
        <button
          style={{
            border: activeTab === "library" ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
            background: activeTab === "library" ? "#eff6ff" : "#fff",
            color: "#0f172a",
            borderRadius: 8,
            padding: "8px 12px",
            cursor: "pointer",
            fontWeight: 700
          }}
          onClick={() => switchTab("library")}
        >
          我的划词库
        </button>
      </div>

      {activeTab === "settings" ? (
        <>
          <section style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 14 }}>
            <h2 style={{ marginTop: 0, marginBottom: 10, fontSize: 18 }}>同步设置</h2>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={syncEnabled}
                onChange={(event) => setSyncEnabled(event.target.checked)}
              />
              启用多端同步
            </label>

            <label style={{ display: "block", marginBottom: 10 }}>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>API Base URL</div>
              <input
                value={apiBaseURL}
                onChange={(event) => setAPIBaseURL(event.target.value)}
                placeholder="http://localhost:8080"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1"
                }}
              />
            </label>
          </section>

          <section style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, marginTop: 12 }}>
            <h2 style={{ marginTop: 0, marginBottom: 10, fontSize: 18 }}>登录与鉴权</h2>
            <label style={{ display: "block", marginBottom: 10 }}>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>邮箱</div>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1"
                }}
              />
            </label>

            <label style={{ display: "block", marginBottom: 10 }}>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>密码</div>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 8 位"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1"
                }}
              />
            </label>

            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <button
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  background: "#1d4ed8",
                  color: "#fff",
                  cursor: "pointer"
                }}
                onClick={() => void authByEndpoint("/register")}
              >
                注册并登录
              </button>
              <button
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  background: "#0f766e",
                  color: "#fff",
                  cursor: "pointer"
                }}
                onClick={() => void authByEndpoint("/login")}
              >
                登录
              </button>
              <button
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  background: "#64748b",
                  color: "#fff",
                  cursor: "pointer"
                }}
                onClick={() => void onLogout()}
              >
                登出
              </button>
            </div>
            {authMessage ? <p style={{ margin: "0 0 10px", color: "#334155", fontSize: 13 }}>{authMessage}</p> : null}

            <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 16 }}>Token（可手动覆盖）</h3>
            <label style={{ display: "block", marginBottom: 10 }}>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>Access Token</div>
              <textarea
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
                rows={3}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1"
                }}
              />
            </label>

            <label style={{ display: "block", marginBottom: 4 }}>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>Refresh Token</div>
              <textarea
                value={refreshToken}
                onChange={(event) => setRefreshToken(event.target.value)}
                rows={3}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1"
                }}
              />
            </label>
          </section>

          <section style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, marginTop: 12 }}>
            <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: 18 }}>同步状态</h2>
            <p style={{ margin: 0, color: "#334155", fontSize: 13 }}>待同步队列: {syncStatus.queueLength}</p>
            <p style={{ margin: "6px 0 0", color: "#334155", fontSize: 13 }}>
              上次同步: {syncStatus.lastSyncAt || "-"}
            </p>
            <p style={{ margin: "6px 0 0", color: syncStatus.lastSyncError ? "#dc2626" : "#334155", fontSize: 13 }}>
              最近错误: {syncStatus.lastSyncError || "无"}
            </p>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  background: "#0f766e",
                  color: "#fff",
                  cursor: "pointer"
                }}
                onClick={() => void loadSyncStatus()}
              >
                刷新状态
              </button>
              <button
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  background: "#7c3aed",
                  color: "#fff",
                  cursor: "pointer"
                }}
                onClick={() => void onRetryConflicts()}
                disabled={syncStatus.conflicts.length === 0}
              >
                重试冲突任务
              </button>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>冲突列表 ({syncStatus.conflicts.length})</div>
              {syncStatus.conflicts.length === 0 ? <div style={{ color: "#64748b" }}>暂无冲突</div> : null}
              {syncStatus.conflicts.slice(-8).map((conflict) => (
                <div
                  key={`${conflict.opId}-${conflict.createdAt}`}
                  style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 8, marginBottom: 6 }}
                >
                  <div style={{ fontSize: 12, color: "#334155" }}>op: {conflict.opId}</div>
                  <div style={{ fontSize: 12, color: "#334155" }}>
                    type: {conflict.operation.opType} | url: {conflict.operation.url}
                  </div>
                  <div style={{ fontSize: 12, color: "#b91c1c" }}>{conflict.message}</div>
                </div>
              ))}
            </div>
          </section>

          <button
            style={{
              marginTop: 14,
              border: "none",
              borderRadius: 8,
              padding: "10px 14px",
              background: "#0f766e",
              color: "#fff",
              cursor: "pointer"
            }}
            onClick={() => void onSave()}
          >
            保存并触发同步
          </button>
          {saved ? <span style={{ marginLeft: 10, color: "#16a34a" }}>已保存</span> : null}
        </>
      ) : null}

      {activeTab === "library" ? (
        <section style={{ border: "1px solid #dbe5f0", borderRadius: 12, background: "#f8fbff", padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>当前用户划词评论</h2>
            <button
              style={{
                border: "1px solid #c6d4e3",
                borderRadius: 8,
                padding: "7px 10px",
                background: "#fff",
                color: "#2f4f6d",
                cursor: "pointer",
                fontWeight: 700
              }}
              onClick={() => {
                void Promise.all([
                  loadURLSummaries(true),
                  selectedURL ? loadAnnotationsByURL(selectedURL) : Promise.resolve()
                ]);
              }}
            >
              刷新划词库
            </button>
          </div>

          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(220px, 32%) minmax(0, 1fr)" }}>
            <aside
              style={{
                border: "1px solid #dbe5f0",
                borderRadius: 10,
                background: "#fff",
                padding: 8,
                minHeight: 300,
                maxHeight: 520,
                overflowY: "auto"
              }}
            >
              <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 700, color: "#486581" }}>网址列表 ({urlSummaries.length})</div>
              {urlSummaries.length === 0 ? <div style={{ color: "#64748b", fontSize: 13 }}>暂无划词数据</div> : null}
              {urlSummaries.map((summary) => {
                const selected = summary.url === selectedURL;
                return (
                  <button
                    key={summary.url}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: selected ? "1px solid #2563eb" : "1px solid #dbe5f0",
                      background: selected ? "#eff6ff" : "#fff",
                      borderRadius: 8,
                      padding: "8px",
                      marginBottom: 6,
                      cursor: "pointer"
                    }}
                    onClick={() => setSelectedURL(summary.url)}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#12314d",
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitBoxOrient: "vertical",
                        WebkitLineClamp: 2
                      }}
                    >
                      {summary.title || summary.url}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: "#486581" }}>共 {summary.count} 条</div>
                    <div style={{ marginTop: 2, fontSize: 11, color: "#829ab1" }}>最近更新: {formatTimestamp(summary.updatedAt)}</div>
                  </button>
                );
              })}
            </aside>

            <section
              style={{
                border: "1px solid #dbe5f0",
                borderRadius: 10,
                background: "#fff",
                padding: 10,
                minHeight: 300,
                maxHeight: 520,
                overflowY: "auto"
              }}
            >
              {selectedURL ? (
                <>
                  <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        color: "#334e68",
                        fontSize: 13,
                        fontWeight: 700,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}
                      title={selectedURL}
                    >
                      {selectedURL}
                    </div>
                    <a
                      href={selectedURL}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        border: "1px solid #c6d4e3",
                        borderRadius: 8,
                        padding: "5px 8px",
                        color: "#2f4f6d",
                        textDecoration: "none",
                        fontWeight: 700,
                        fontSize: 12,
                        whiteSpace: "nowrap"
                      }}
                    >
                      打开网页
                    </a>
                  </div>

                  {libraryLoading ? <p style={{ color: "#486581", fontSize: 13 }}>加载中...</p> : null}
                  {libraryError ? <p style={{ color: "#dc2626", fontSize: 13 }}>{libraryError}</p> : null}
                  {!libraryLoading && selectedAnnotations.length === 0 ? (
                    <p style={{ color: "#64748b", fontSize: 13 }}>该网址暂无高亮内容</p>
                  ) : null}
                  {selectedAnnotations.map((annotation) => (
                    <article
                      key={annotation.id}
                      style={{
                        border: "1px solid #dbe5f0",
                        borderRadius: 10,
                        padding: 10,
                        marginBottom: 8,
                        background: "#ffffff"
                      }}
                    >
                      <div
                        style={{
                          borderRadius: 8,
                          padding: "6px 8px",
                          fontWeight: 700,
                          lineHeight: 1.5,
                          borderLeft: `3px solid ${annotation.color}`,
                          background: `${annotation.color}40`
                        }}
                      >
                        {annotation.quoteText}
                      </div>
                      <div style={{ marginTop: 8, color: "#486581", fontSize: 13, lineHeight: 1.45 }}>
                        {annotation.commentText || "(无评论)"}
                      </div>
                      <div style={{ marginTop: 8, color: "#829ab1", fontSize: 12 }}>
                        更新时间: {formatTimestamp(annotation.updatedAt)}
                      </div>
                    </article>
                  ))}
                </>
              ) : (
                <p style={{ color: "#64748b", fontSize: 13 }}>请选择左侧网址查看该页划词评论</p>
              )}
            </section>
          </div>
        </section>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>
);
