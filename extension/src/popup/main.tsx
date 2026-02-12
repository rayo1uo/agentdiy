import React from "react";
import { createRoot } from "react-dom/client";

const containerStyle: React.CSSProperties = {
  width: 320,
  padding: 16,
  fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  background: "#f8fafc",
  color: "#0f172a"
};

const buttonStyle: React.CSSProperties = {
  marginTop: 12,
  border: "none",
  borderRadius: 8,
  padding: "10px 12px",
  background: "#1d4ed8",
  color: "#ffffff",
  fontWeight: 600,
  cursor: "pointer",
  width: "100%"
};

function PopupApp(): JSX.Element {
  const [status, setStatus] = React.useState("Ready");

  const openSidePanel = async (): Promise<void> => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setStatus("No active tab.");
        return;
      }

      await chrome.sidePanel.open({ tabId: tab.id });
      setStatus("Side panel opened.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to open side panel.");
    }
  };

  const triggerSyncNow = async (): Promise<void> => {
    try {
      await chrome.runtime.sendMessage({ type: "sync.now", payload: { reason: "popup-click" } });
      setStatus("Sync scheduled.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to schedule sync.");
    }
  };

  return (
    <main style={containerStyle}>
      <h2 style={{ margin: 0, fontSize: 18 }}>Annota MVP</h2>
      <p style={{ marginTop: 8, fontSize: 13, lineHeight: 1.4 }}>
        已支持网页划词高亮、评论，以及侧边栏管理（本地存储版）。
      </p>
      <button style={buttonStyle} onClick={() => void openSidePanel()}>
        打开侧边栏
      </button>
      <button style={{ ...buttonStyle, background: "#0f766e" }} onClick={() => void triggerSyncNow()}>
        立即同步
      </button>
      <p style={{ marginTop: 10, fontSize: 12, color: "#334155" }}>{status}</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>
);
