import React from "react";
import { createRoot } from "react-dom/client";
import type { Annotation } from "@/shared/annotation";
import type { AnnotationChangedEvent, AnnotationListResponse } from "@/shared/messages";
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

function SidePanelApp(): JSX.Element {
  const [url, setURL] = React.useState("");
  const [tabID, setTabID] = React.useState<number | null>(null);
  const [annotations, setAnnotations] = React.useState<Annotation[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const reload = React.useCallback(async (targetURL?: string) => {
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
  }, [url]);

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

  return (
    <main style={containerStyle}>
      <h2 style={{ margin: 0, fontSize: 18 }}>页面高亮与评论</h2>
      <p style={{ marginTop: 8, color: "#475569", fontSize: 12, wordBreak: "break-all" }}>{url || "当前标签页无 URL"}</p>
      {loading ? <p>加载中...</p> : null}
      {error ? <p style={{ color: "#dc2626" }}>{error}</p> : null}
      {!loading && annotations.length === 0 ? <p>暂无高亮，先去页面划词试试。</p> : null}
      {annotations.map((annotation) => (
        <article key={annotation.id} style={cardStyle}>
          <div style={{ fontWeight: 600, lineHeight: 1.4 }}>
            {annotation.quoteText}
          </div>
          <p style={{ color: "#475569", marginBottom: 8, marginTop: 8 }}>
            {annotation.commentText || "(无评论)"}
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            <button style={buttonStyle} onClick={() => void onFocus(annotation.id)}>
              定位
            </button>
            <button style={buttonStyle} onClick={() => void onEdit(annotation)}>
              编辑评论
            </button>
            <button style={buttonStyle} onClick={() => void onDelete(annotation)}>
              删除
            </button>
          </div>
        </article>
      ))}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SidePanelApp />
  </React.StrictMode>
);
