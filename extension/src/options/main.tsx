import React from "react";
import { createRoot } from "react-dom/client";
import { sendRuntimeMessage } from "@/lib/runtime";
import { markdownToHTML } from "@/lib/markdown";
import type { Annotation } from "@/shared/annotation";
import type {
  AnnotationListResponse,
  AnnotationURLSummary,
  AnnotationURLSummaryResponse
} from "@/shared/messages";
import type { SyncConflictItem } from "@/shared/sync";
import "@/shared/markdown.css";
import "./styles.css";

const SETTINGS_KEY_SYNC_ENABLED = "settings:syncEnabled";
const SETTINGS_KEY_API_BASE = "settings:apiBaseUrl";
const SETTINGS_KEY_TOOLBAR_OPACITY = "settings:toolbarOpacity";
const SETTINGS_KEY_TOOLBAR_WIDTH = "settings:toolbarWidth";
const SETTINGS_KEY_DIALOG_DEFAULT_ENABLED = "settings:dialogDefaultEnabled";
const SETTINGS_KEY_DIALOG_LEGACY_ENABLED = "settings:dialogEnabledByAction";
const AUTH_KEY_ACCESS_TOKEN = "auth:accessToken";
const AUTH_KEY_REFRESH_TOKEN = "auth:refreshToken";
const SYNC_KEY_QUEUE = "sync:queue";
const SYNC_KEY_CONFLICTS = "sync:conflicts";
const SYNC_KEY_CURSOR = "sync:cursor";
const SYNC_KEY_LAST_SYNC_AT = "sync:lastSyncAt";
const SYNC_KEY_LAST_SYNC_ERROR = "sync:lastSyncError";
const ANNOTATION_KEY_PREFIX = "annotations:";
const TOOLBAR_OPACITY_MIN = 0.55;
const TOOLBAR_OPACITY_MAX = 1;
const TOOLBAR_WIDTH_MIN = 240;
const TOOLBAR_WIDTH_MAX = 520;
const LIBRARY_PAGE_SIZE_OPTIONS = [5, 10, 20] as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

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
  const [toolbarOpacity, setToolbarOpacity] = React.useState(0.92);
  const [toolbarWidth, setToolbarWidth] = React.useState(320);
  const [dialogDefaultEnabled, setDialogDefaultEnabled] = React.useState(true);
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
  const selectedURLRef = React.useRef("");
  const [selectedAnnotations, setSelectedAnnotations] = React.useState<Annotation[]>([]);
  const [libraryLoading, setLibraryLoading] = React.useState(false);
  const [libraryError, setLibraryError] = React.useState("");
  const [librarySearchKeyword, setLibrarySearchKeyword] = React.useState("");
  const [libraryPage, setLibraryPage] = React.useState(1);
  const [libraryPageSize, setLibraryPageSize] = React.useState<number>(LIBRARY_PAGE_SIZE_OPTIONS[0]);
  const [libraryURLPage, setLibraryURLPage] = React.useState(1);
  const [libraryURLPageSize, setLibraryURLPageSize] = React.useState<number>(LIBRARY_PAGE_SIZE_OPTIONS[0]);
  const libraryBootstrappedRef = React.useRef(false);
  const [libraryMatchedURLs, setLibraryMatchedURLs] = React.useState<string[] | null>(null);

  const loadSyncStatus = React.useCallback(async () => {
    const status = await sendRuntimeMessage<SyncStatus>({ type: "sync.conflicts.list", payload: {} });
    setSyncStatus(status);
  }, []);

  React.useEffect(() => {
    selectedURLRef.current = selectedURL;
  }, [selectedURL]);

  const loadURLSummaries = React.useCallback(
    async (keepSelection = true): Promise<string> => {
      const response = await sendRuntimeMessage<AnnotationURLSummaryResponse>({
        type: "annotation.urls",
        payload: {}
      });
      const current = selectedURLRef.current;
      const nextSelected =
        keepSelection && current && response.summaries.some((item) => item.url === current)
          ? current
          : (response.summaries[0]?.url ?? "");

      setURLSummaries(response.summaries);
      setSelectedURL(nextSelected);
      return nextSelected;
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
        chrome.storage.sync.get([
          SETTINGS_KEY_SYNC_ENABLED,
          SETTINGS_KEY_API_BASE,
          SETTINGS_KEY_TOOLBAR_OPACITY,
          SETTINGS_KEY_TOOLBAR_WIDTH,
          SETTINGS_KEY_DIALOG_DEFAULT_ENABLED,
          SETTINGS_KEY_DIALOG_LEGACY_ENABLED
        ]),
        chrome.storage.local.get([AUTH_KEY_ACCESS_TOKEN, AUTH_KEY_REFRESH_TOKEN])
      ]);

      if (typeof syncData[SETTINGS_KEY_SYNC_ENABLED] === "boolean") {
        setSyncEnabled(syncData[SETTINGS_KEY_SYNC_ENABLED] as boolean);
      }

      if (typeof syncData[SETTINGS_KEY_API_BASE] === "string") {
        setAPIBaseURL(syncData[SETTINGS_KEY_API_BASE] as string);
      }
      if (typeof syncData[SETTINGS_KEY_TOOLBAR_OPACITY] === "number") {
        setToolbarOpacity(clamp(syncData[SETTINGS_KEY_TOOLBAR_OPACITY] as number, TOOLBAR_OPACITY_MIN, TOOLBAR_OPACITY_MAX));
      }
      if (typeof syncData[SETTINGS_KEY_TOOLBAR_WIDTH] === "number") {
        setToolbarWidth(clamp(syncData[SETTINGS_KEY_TOOLBAR_WIDTH] as number, TOOLBAR_WIDTH_MIN, TOOLBAR_WIDTH_MAX));
      }
      if (typeof syncData[SETTINGS_KEY_DIALOG_DEFAULT_ENABLED] === "boolean") {
        setDialogDefaultEnabled(syncData[SETTINGS_KEY_DIALOG_DEFAULT_ENABLED] as boolean);
      } else if (typeof syncData[SETTINGS_KEY_DIALOG_LEGACY_ENABLED] === "boolean") {
        setDialogDefaultEnabled(syncData[SETTINGS_KEY_DIALOG_LEGACY_ENABLED] as boolean);
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

  const getManifestContentScriptFiles = React.useCallback((): string[] => {
    const manifest = chrome.runtime.getManifest();
    const files: string[] = [];
    for (const item of manifest.content_scripts ?? []) {
      for (const file of item.js ?? []) {
        if (typeof file === "string" && file.trim()) {
          files.push(file);
        }
      }
    }
    return files;
  }, []);

  const broadcastRefreshToOpenTabs = React.useCallback(async (): Promise<void> => {
    const tabs = await chrome.tabs.query({});
    const contentScriptFiles = getManifestContentScriptFiles();
    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id == null) {
          return;
        }
        if (!tab.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) {
          return;
        }
        try {
          await chrome.tabs.sendMessage(tab.id, { type: "annotation.refreshAll", payload: {} });
        } catch {
          if (contentScriptFiles.length === 0) {
            return;
          }
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: contentScriptFiles
            });
            await chrome.tabs.sendMessage(tab.id, { type: "annotation.refreshAll", payload: {} });
          } catch {
            // Ignore tabs where script injection is not allowed or still unavailable.
          }
        }
      })
    );
  }, [getManifestContentScriptFiles]);

  const onSave = async (): Promise<void> => {
    try {
      await Promise.all([
        chrome.storage.sync.set({
          [SETTINGS_KEY_SYNC_ENABLED]: syncEnabled,
          [SETTINGS_KEY_API_BASE]: apiBaseURL.trim(),
          [SETTINGS_KEY_TOOLBAR_OPACITY]: clamp(toolbarOpacity, TOOLBAR_OPACITY_MIN, TOOLBAR_OPACITY_MAX),
          [SETTINGS_KEY_TOOLBAR_WIDTH]: clamp(toolbarWidth, TOOLBAR_WIDTH_MIN, TOOLBAR_WIDTH_MAX),
          [SETTINGS_KEY_DIALOG_DEFAULT_ENABLED]: dialogDefaultEnabled
        }),
        chrome.storage.local.set({
          [AUTH_KEY_ACCESS_TOKEN]: accessToken.trim(),
          [AUTH_KEY_REFRESH_TOKEN]: refreshToken.trim()
        })
      ]);

      await sendRuntimeMessage({ type: "sync.now", payload: { reason: "settings-save", wait: true } });

      setSaved(true);
      window.setTimeout(() => setSaved(false), 1200);
      await loadSyncStatus();
      await broadcastRefreshToOpenTabs();
    } catch (error) {
      setAuthMessage(error instanceof Error ? `保存失败: ${error.message}` : "保存失败");
    }
  };

  const authByEndpoint = async (endpoint: "/register" | "/login"): Promise<void> => {
    const baseURL = apiBaseURL.trim().replace(/\/+$/, "");
    if (!baseURL || !email.trim() || !password.trim()) {
      setAuthMessage("请先填写 API 地址、邮箱、密码");
      return;
    }

    setAuthMessage("认证中...");
    try {
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
      await chrome.storage.sync.set({
        [SETTINGS_KEY_API_BASE]: baseURL,
        [SETTINGS_KEY_SYNC_ENABLED]: true
      });
      setAccessToken(nextAccess);
      setRefreshToken(nextRefresh);
      setAPIBaseURL(baseURL);
      setSyncEnabled(true);
      setAuthMessage("认证成功，token 已写入");
      await sendRuntimeMessage({ type: "sync.now", payload: { reason: "auth-success", wait: true } });
      await Promise.all([loadSyncStatus(), loadURLSummaries(false)]);
      await broadcastRefreshToOpenTabs();
    } catch (error) {
      setAuthMessage(error instanceof Error ? `认证失败: ${error.message}` : "认证失败");
    }
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

    const allLocal = await chrome.storage.local.get(null);
    const annotationKeys = Object.keys(allLocal).filter((key) => key.startsWith(ANNOTATION_KEY_PREFIX));
    const keysToRemove = [
      AUTH_KEY_ACCESS_TOKEN,
      AUTH_KEY_REFRESH_TOKEN,
      SYNC_KEY_QUEUE,
      SYNC_KEY_CONFLICTS,
      SYNC_KEY_CURSOR,
      SYNC_KEY_LAST_SYNC_AT,
      SYNC_KEY_LAST_SYNC_ERROR,
      ...annotationKeys
    ];
    await chrome.storage.local.remove(keysToRemove);
    setAccessToken("");
    setRefreshToken("");
    setURLSummaries([]);
    setSelectedURL("");
    setSelectedAnnotations([]);
    setAuthMessage("已退出登录并清理本地 token");
    await Promise.all([loadSyncStatus(), loadURLSummaries(false)]);
    await broadcastRefreshToOpenTabs();
  };

  const onRetryConflicts = async (): Promise<void> => {
    try {
      await sendRuntimeMessage({ type: "sync.conflicts.retry", payload: {} });
      await sendRuntimeMessage({ type: "sync.now", payload: { reason: "options-retry-conflicts", wait: true } });
      await Promise.all([loadSyncStatus(), loadURLSummaries(true)]);
    } catch (error) {
      setAuthMessage(error instanceof Error ? `重试冲突失败: ${error.message}` : "重试冲突失败");
    }
  };

  const onRefreshSyncStatus = async (): Promise<void> => {
    try {
      await sendRuntimeMessage({ type: "sync.now", payload: { reason: "options-refresh-status", wait: true } });
      await loadSyncStatus();
    } catch (error) {
      setAuthMessage(error instanceof Error ? `刷新同步状态失败: ${error.message}` : "刷新同步状态失败");
    }
  };

  const onRefreshLibrary = async (): Promise<void> => {
    setLibraryError("");
    try {
      await sendRuntimeMessage({ type: "sync.now", payload: { reason: "options-library-refresh", wait: true } });
      const nextURL = await loadURLSummaries(true);
      await loadAnnotationsByURL(nextURL);
      await loadSyncStatus();
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "刷新划词库失败");
    }
  };
  React.useEffect(() => {
    if (activeTab !== "library" || libraryBootstrappedRef.current) {
      return;
    }
    libraryBootstrappedRef.current = true;
    if (urlSummaries.length === 0) {
      void onRefreshLibrary();
    }
  }, [activeTab, onRefreshLibrary, urlSummaries.length]);

  const normalizedLibraryKeyword = React.useMemo(() => librarySearchKeyword.trim().toLowerCase(), [librarySearchKeyword]);
  React.useEffect(() => {
    if (!normalizedLibraryKeyword) {
      setLibraryMatchedURLs(null);
      return;
    }

    let disposed = false;
    setLibraryMatchedURLs(null);

    void (async () => {
      try {
        const urls = urlSummaries.map((item) => item.url).filter(Boolean);
        if (urls.length === 0) {
          if (!disposed) {
            setLibraryMatchedURLs([]);
          }
          return;
        }

        const keys = urls.map((url) => `${ANNOTATION_KEY_PREFIX}${url}`);
        const allLocal = await chrome.storage.local.get(keys);
        const matchedByAnnotation: string[] = [];
        const matchedByMetaOnly: string[] = [];
        const seen = new Set<string>();

        for (const summary of urlSummaries) {
          const title = (summary.title ?? "").toLowerCase();
          const urlText = (summary.url ?? "").toLowerCase();
          const metaMatched = title.includes(normalizedLibraryKeyword) || urlText.includes(normalizedLibraryKeyword);

          const key = `${ANNOTATION_KEY_PREFIX}${summary.url}`;
          const annotations = (allLocal[key] ?? []) as Annotation[];
          const hasMatch = annotations.some((annotation) => {
            if (annotation.status !== "active") {
              return false;
            }
            const quote = (annotation.quoteText ?? "").toLowerCase();
            const comment = (annotation.commentText ?? "").toLowerCase();
            return quote.includes(normalizedLibraryKeyword) || comment.includes(normalizedLibraryKeyword);
          });
          if (hasMatch) {
            if (!seen.has(summary.url)) {
              matchedByAnnotation.push(summary.url);
              seen.add(summary.url);
            }
            continue;
          }

          if (metaMatched && !seen.has(summary.url)) {
            matchedByMetaOnly.push(summary.url);
            seen.add(summary.url);
          }
        }

        if (!disposed) {
          setLibraryMatchedURLs([...matchedByAnnotation, ...matchedByMetaOnly]);
        }
      } catch {
        if (!disposed) {
          setLibraryMatchedURLs([]);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [normalizedLibraryKeyword, urlSummaries]);

  const filteredURLSummaries = React.useMemo(() => {
    if (!normalizedLibraryKeyword) {
      return urlSummaries;
    }
    if (!libraryMatchedURLs) {
      return [];
    }
    const matchedSet = new Set(libraryMatchedURLs);
    return urlSummaries.filter((item) => matchedSet.has(item.url));
  }, [libraryMatchedURLs, normalizedLibraryKeyword, urlSummaries]);

  React.useEffect(() => {
    if (activeTab !== "library") {
      return;
    }
    if (filteredURLSummaries.some((item) => item.url === selectedURL)) {
      return;
    }
    setSelectedURL(filteredURLSummaries[0]?.url ?? "");
  }, [activeTab, filteredURLSummaries, selectedURL]);
  const libraryURLTotalPages = React.useMemo(() => {
    if (filteredURLSummaries.length === 0) {
      return 1;
    }
    return Math.ceil(filteredURLSummaries.length / libraryURLPageSize);
  }, [filteredURLSummaries.length, libraryURLPageSize]);
  React.useEffect(() => {
    setLibraryURLPage(1);
  }, [normalizedLibraryKeyword, libraryURLPageSize]);
  React.useEffect(() => {
    if (filteredURLSummaries.length === 0) {
      if (libraryURLPage !== 1) {
        setLibraryURLPage(1);
      }
      return;
    }

    if (libraryURLPage > libraryURLTotalPages) {
      setLibraryURLPage(libraryURLTotalPages);
    }
  }, [filteredURLSummaries, libraryURLPage, libraryURLTotalPages]);
  const pagedFilteredURLSummaries = React.useMemo(() => {
    const start = (libraryURLPage - 1) * libraryURLPageSize;
    return filteredURLSummaries.slice(start, start + libraryURLPageSize);
  }, [filteredURLSummaries, libraryURLPage, libraryURLPageSize]);
  React.useEffect(() => {
    if (activeTab !== "library") {
      return;
    }
    if (pagedFilteredURLSummaries.length === 0) {
      if (selectedURL) {
        setSelectedURL("");
      }
      return;
    }
    if (!pagedFilteredURLSummaries.some((item) => item.url === selectedURL)) {
      setSelectedURL(pagedFilteredURLSummaries[0].url);
    }
  }, [activeTab, pagedFilteredURLSummaries, selectedURL]);

  const filteredSelectedAnnotations = React.useMemo(() => {
    if (!normalizedLibraryKeyword) {
      return selectedAnnotations;
    }
    return selectedAnnotations.filter((item) => {
      const quote = (item.quoteText ?? "").toLowerCase();
      const comment = (item.commentText ?? "").toLowerCase();
      return quote.includes(normalizedLibraryKeyword) || comment.includes(normalizedLibraryKeyword);
    });
  }, [normalizedLibraryKeyword, selectedAnnotations]);
  const libraryTotalPages = React.useMemo(() => {
    if (filteredSelectedAnnotations.length === 0) {
      return 1;
    }
    return Math.ceil(filteredSelectedAnnotations.length / libraryPageSize);
  }, [filteredSelectedAnnotations.length, libraryPageSize]);
  React.useEffect(() => {
    setLibraryPage(1);
  }, [selectedURL, normalizedLibraryKeyword, libraryPageSize]);
  React.useEffect(() => {
    if (libraryPage > libraryTotalPages) {
      setLibraryPage(libraryTotalPages);
    }
  }, [libraryPage, libraryTotalPages]);
  const pagedFilteredSelectedAnnotations = React.useMemo(() => {
    const start = (libraryPage - 1) * libraryPageSize;
    return filteredSelectedAnnotations.slice(start, start + libraryPageSize);
  }, [filteredSelectedAnnotations, libraryPage, libraryPageSize]);

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

            <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={dialogDefaultEnabled}
                onChange={(event) => setDialogDefaultEnabled(event.target.checked)}
              />
              默认启用页面高亮与评论弹窗（可通过扩展图标为当前网页单独开/关）
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

            <label style={{ display: "block", marginBottom: 10 }}>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>划词弹窗透明度 ({Math.round(toolbarOpacity * 100)}%)</div>
              <input
                type="range"
                min={Math.round(TOOLBAR_OPACITY_MIN * 100)}
                max={Math.round(TOOLBAR_OPACITY_MAX * 100)}
                step={1}
                value={Math.round(toolbarOpacity * 100)}
                onChange={(event) =>
                  setToolbarOpacity(
                    clamp(Number(event.target.value) / 100, TOOLBAR_OPACITY_MIN, TOOLBAR_OPACITY_MAX)
                  )
                }
                style={{ width: "100%" }}
              />
            </label>

            <label style={{ display: "block" }}>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>划词弹窗宽度 ({Math.round(toolbarWidth)}px)</div>
              <input
                type="range"
                min={TOOLBAR_WIDTH_MIN}
                max={TOOLBAR_WIDTH_MAX}
                step={10}
                value={Math.round(toolbarWidth)}
                onChange={(event) =>
                  setToolbarWidth(clamp(Number(event.target.value), TOOLBAR_WIDTH_MIN, TOOLBAR_WIDTH_MAX))
                }
                style={{ width: "100%" }}
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
                onClick={() => void onRefreshSyncStatus()}
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
                void onRefreshLibrary();
              }}
            >
              刷新划词库
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input
              value={librarySearchKeyword}
              onChange={(event) => setLibrarySearchKeyword(event.target.value)}
              placeholder="搜索划词关键词（句子/评论/网址）"
              style={{
                flex: 1,
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid #cbd5e1"
              }}
            />
            {librarySearchKeyword.trim() ? (
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
                onClick={() => setLibrarySearchKeyword("")}
              >
                清空
              </button>
            ) : null}
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
                display: "flex",
                flexDirection: "column"
              }}
            >
              <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 700, color: "#486581" }}>
                网址列表 ({filteredURLSummaries.length})
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                {urlSummaries.length === 0 ? <div style={{ color: "#64748b", fontSize: 13 }}>暂无划词数据</div> : null}
                {normalizedLibraryKeyword && libraryMatchedURLs === null ? (
                  <div style={{ color: "#64748b", fontSize: 13 }}>筛选中...</div>
                ) : null}
                {urlSummaries.length > 0 && filteredURLSummaries.length === 0 && libraryMatchedURLs !== null ? (
                  <div style={{ color: "#64748b", fontSize: 13 }}>暂无匹配网址</div>
                ) : null}
                {pagedFilteredURLSummaries.map((summary) => {
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
              </div>
              {filteredURLSummaries.length > 0 ? (
                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexWrap: "wrap"
                  }}
                >
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#486581", fontSize: 12 }}>
                    每页
                    <select
                      value={libraryURLPageSize}
                      onChange={(event) => setLibraryURLPageSize(Number(event.target.value))}
                      style={{
                        border: "1px solid #cbd5e1",
                        borderRadius: 8,
                        background: "#fff",
                        color: "#0f172a",
                        padding: "4px 8px",
                        fontSize: 12
                      }}
                    >
                      {LIBRARY_PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <button
                      onClick={() => setLibraryURLPage((current) => Math.max(1, current - 1))}
                      disabled={libraryURLPage <= 1}
                      style={{
                        border: "1px solid #c6d4e3",
                        borderRadius: 8,
                        padding: "5px 8px",
                        background: "#fff",
                        color: "#2f4f6d",
                        fontWeight: 700,
                        cursor: libraryURLPage <= 1 ? "not-allowed" : "pointer",
                        opacity: libraryURLPage <= 1 ? 0.6 : 1
                      }}
                    >
                      上一页
                    </button>
                    <span style={{ color: "#486581", fontSize: 12 }}>
                      第 {libraryURLPage}/{libraryURLTotalPages} 页
                    </span>
                    <button
                      onClick={() => setLibraryURLPage((current) => Math.min(libraryURLTotalPages, current + 1))}
                      disabled={libraryURLPage >= libraryURLTotalPages}
                      style={{
                        border: "1px solid #c6d4e3",
                        borderRadius: 8,
                        padding: "5px 8px",
                        background: "#fff",
                        color: "#2f4f6d",
                        fontWeight: 700,
                        cursor: libraryURLPage >= libraryURLTotalPages ? "not-allowed" : "pointer",
                        opacity: libraryURLPage >= libraryURLTotalPages ? 0.6 : 1
                      }}
                    >
                      下一页
                    </button>
                  </div>
                </div>
              ) : null}
            </aside>

            <section
              style={{
                border: "1px solid #dbe5f0",
                borderRadius: 10,
                background: "#fff",
                padding: 10,
                minHeight: 300,
                maxHeight: 520,
                display: "flex",
                flexDirection: "column"
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

                  <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                    {libraryLoading ? <p style={{ color: "#486581", fontSize: 13 }}>加载中...</p> : null}
                    {libraryError ? <p style={{ color: "#dc2626", fontSize: 13 }}>{libraryError}</p> : null}
                    {!libraryLoading && selectedAnnotations.length === 0 ? (
                      <p style={{ color: "#64748b", fontSize: 13 }}>该网址暂无高亮内容</p>
                    ) : null}
                    {!libraryLoading && selectedAnnotations.length > 0 && filteredSelectedAnnotations.length === 0 ? (
                      <p style={{ color: "#64748b", fontSize: 13 }}>未搜索到匹配高亮句子</p>
                    ) : null}
                    {pagedFilteredSelectedAnnotations.map((annotation) => (
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
                        {annotation.commentText?.trim() ? (
                          <div
                            className="opt-comment-markdown annota-markdown"
                            dangerouslySetInnerHTML={{ __html: markdownToHTML(annotation.commentText) }}
                          />
                        ) : (
                          <div style={{ marginTop: 8, color: "#486581", fontSize: 13, lineHeight: 1.45 }}>(无评论)</div>
                        )}
                        <div style={{ marginTop: 8, color: "#829ab1", fontSize: 12 }}>
                          更新时间: {formatTimestamp(annotation.updatedAt)}
                        </div>
                      </article>
                    ))}
                  </div>
                  {!libraryLoading && filteredSelectedAnnotations.length > 0 ? (
                    <div
                      style={{
                        marginTop: 8,
                        paddingTop: 8,
                        borderTop: "1px solid #e2e8f0",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                        background: "#fff"
                      }}
                    >
                      <span style={{ color: "#486581", fontSize: 12 }}>
                        共 {filteredSelectedAnnotations.length} 条
                        {normalizedLibraryKeyword ? `（总 ${selectedAnnotations.length} 条）` : ""}
                      </span>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#486581", fontSize: 12 }}>
                        每页
                        <select
                          value={libraryPageSize}
                          onChange={(event) => setLibraryPageSize(Number(event.target.value))}
                          style={{
                            border: "1px solid #cbd5e1",
                            borderRadius: 8,
                            background: "#fff",
                            color: "#0f172a",
                            padding: "4px 8px",
                            fontSize: 12
                          }}
                        >
                          {LIBRARY_PAGE_SIZE_OPTIONS.map((size) => (
                            <option key={size} value={size}>
                              {size}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <button
                          onClick={() => setLibraryPage((current) => Math.max(1, current - 1))}
                          disabled={libraryPage <= 1}
                          style={{
                            border: "1px solid #c6d4e3",
                            borderRadius: 8,
                            padding: "5px 8px",
                            background: "#fff",
                            color: "#2f4f6d",
                            fontWeight: 700,
                            cursor: libraryPage <= 1 ? "not-allowed" : "pointer",
                            opacity: libraryPage <= 1 ? 0.6 : 1
                          }}
                        >
                          上一页
                        </button>
                        <span style={{ color: "#486581", fontSize: 12 }}>
                          第 {libraryPage}/{libraryTotalPages} 页
                        </span>
                        <button
                          onClick={() => setLibraryPage((current) => Math.min(libraryTotalPages, current + 1))}
                          disabled={libraryPage >= libraryTotalPages}
                          style={{
                            border: "1px solid #c6d4e3",
                            borderRadius: 8,
                            padding: "5px 8px",
                            background: "#fff",
                            color: "#2f4f6d",
                            fontWeight: 700,
                            cursor: libraryPage >= libraryTotalPages ? "not-allowed" : "pointer",
                            opacity: libraryPage >= libraryTotalPages ? 0.6 : 1
                          }}
                        >
                          下一页
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <p style={{ color: "#64748b", fontSize: 13, marginTop: 0 }}>
                  {normalizedLibraryKeyword && filteredURLSummaries.length === 0
                    ? "未搜索到匹配网址"
                    : "请选择左侧网址查看该页划词评论"}
                </p>
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
