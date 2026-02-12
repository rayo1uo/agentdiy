import React from "react";
import { createRoot } from "react-dom/client";

const SETTINGS_KEY = "settings:syncEnabled";

function OptionsApp(): JSX.Element {
  const [syncEnabled, setSyncEnabled] = React.useState(true);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    void chrome.storage.sync.get(SETTINGS_KEY).then((result) => {
      if (typeof result[SETTINGS_KEY] === "boolean") {
        setSyncEnabled(result[SETTINGS_KEY] as boolean);
      }
    });
  }, []);

  const onSave = async (): Promise<void> => {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: syncEnabled });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  };

  return (
    <main
      style={{
        margin: "24px auto",
        maxWidth: 680,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        color: "#0f172a"
      }}
    >
      <h1 style={{ marginBottom: 10 }}>Annota 设置</h1>
      <p style={{ marginTop: 0, color: "#475569" }}>
        当前为 MVP 阶段，此处仅保留基础同步开关配置。
      </p>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={syncEnabled}
          onChange={(event) => setSyncEnabled(event.target.checked)}
        />
        启用多端同步（后端接入后生效）
      </label>
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
        保存
      </button>
      {saved ? <span style={{ marginLeft: 10, color: "#16a34a" }}>已保存</span> : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>
);
