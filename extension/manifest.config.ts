import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Annota MVP",
  version: "0.1.0",
  description: "Highlight and comment on web pages with multi-device sync-ready architecture.",
  permissions: ["storage", "activeTab", "scripting", "tabs", "sidePanel", "alarms"],
  host_permissions: ["<all_urls>"],
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
  },
  action: {
    default_title: "Annota MVP",
    default_popup: "src/popup/index.html"
  },
  options_page: "src/options/index.html",
  side_panel: {
    default_path: "src/sidepanel/index.html"
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      css: ["src/content/styles.css"],
      run_at: "document_idle"
    }
  ]
});
