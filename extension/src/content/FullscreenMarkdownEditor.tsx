import React from "react";
import { createPortal } from "react-dom";
import MDEditor, { type ICommand, type PreviewType } from "@uiw/react-md-editor";
import rehypeSanitize from "rehype-sanitize";
import { useHotkeys } from "./useHotkeys";
import { useLockBodyScroll } from "./useLockBodyScroll";

export type EditorSnapshot = {
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
};

type FullscreenMarkdownEditorProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  value: string;
  placeholder: string;
  rows: number;
  commands: ICommand[];
  dirty: boolean;
  saveLabel?: string;
  onChange: (next: string) => void;
  onEditorKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onRequestSave: () => Promise<boolean> | boolean | void;
  onRequestCancel: () => void;
  onRequestExitFullscreen: (snapshot: EditorSnapshot | null) => void;
  initialSnapshot?: EditorSnapshot | null;
};

const MIN_SPLIT_WIDTH = 900;
const SPLIT_RATIO_KEY = "annota:fullscreenSplitRatio";
const DENSITY_KEY = "annota:fullscreenDensity";

type DensityMode = "compact" | "comfortable" | "large";

const isDensityMode = (value: string): value is DensityMode =>
  value === "compact" || value === "comfortable" || value === "large";

const getEditorTextarea = (root: HTMLElement | null): HTMLTextAreaElement | null =>
  root?.querySelector<HTMLTextAreaElement>("textarea.w-md-editor-text-input") ?? null;

const captureEditorSnapshot = (textarea: HTMLTextAreaElement | null): EditorSnapshot | null => {
  if (!textarea) {
    return null;
  }
  return {
    selectionStart: textarea.selectionStart ?? 0,
    selectionEnd: textarea.selectionEnd ?? textarea.selectionStart ?? 0,
    scrollTop: textarea.scrollTop ?? 0
  };
};

const restoreEditorSnapshot = (textarea: HTMLTextAreaElement | null, snapshot?: EditorSnapshot | null): void => {
  if (!textarea || !snapshot) {
    return;
  }
  const maxSelection = textarea.value.length;
  const selectionStart = Math.max(0, Math.min(snapshot.selectionStart, maxSelection));
  const selectionEnd = Math.max(selectionStart, Math.min(snapshot.selectionEnd, maxSelection));
  textarea.selectionStart = selectionStart;
  textarea.selectionEnd = selectionEnd;
  textarea.scrollTop = Math.max(0, snapshot.scrollTop);
};

const countCharacters = (input: string): number => input.replace(/\s+/g, "").length;

const getFocusableElements = (root: HTMLElement): HTMLElement[] => {
  const nodes = root.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  return Array.from(nodes).filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1);
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const formatTime = (date: Date | null): string => {
  if (!date) {
    return "-";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export const FullscreenMarkdownEditor = ({
  open,
  title,
  subtitle,
  value,
  placeholder,
  rows,
  commands,
  dirty,
  saveLabel = "保存评论",
  onChange,
  onEditorKeyDown,
  onRequestSave,
  onRequestCancel,
  onRequestExitFullscreen,
  initialSnapshot
}: FullscreenMarkdownEditorProps): JSX.Element | null => {
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const splitRef = React.useRef<HTMLDivElement | null>(null);
  const lastSnapshotRef = React.useRef<EditorSnapshot | null>(initialSnapshot ?? null);
  const [mode, setMode] = React.useState<PreviewType>("live");
  const [isNarrow, setIsNarrow] = React.useState<boolean>(window.innerWidth < MIN_SPLIT_WIDTH);
  const [isSaving, setIsSaving] = React.useState(false);
  const [lastSavedAt, setLastSavedAt] = React.useState<Date | null>(null);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [confirmAction, setConfirmAction] = React.useState<"exit" | "cancel" | null>(null);
  const [lightbox, setLightbox] = React.useState<{ src: string; alt: string } | null>(null);
  const [density, setDensity] = React.useState<DensityMode>(() => {
    try {
      const raw = window.localStorage.getItem(DENSITY_KEY);
      if (raw && isDensityMode(raw)) {
        return raw;
      }
    } catch {
      // ignore read failure
    }
    return "comfortable";
  });
  const [splitRatio, setSplitRatio] = React.useState(() => {
    const raw = window.localStorage.getItem(SPLIT_RATIO_KEY);
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed)) {
      return clamp(parsed, 0.3, 0.7);
    }
    return 0.5;
  });

  useLockBodyScroll(open);

  const focusEditor = React.useCallback(() => {
    const textarea = getEditorTextarea(overlayRef.current);
    textarea?.focus();
  }, []);

  const doExit = React.useCallback(() => {
    const snapshot = captureEditorSnapshot(getEditorTextarea(overlayRef.current)) ?? lastSnapshotRef.current;
    onRequestExitFullscreen(snapshot);
  }, [onRequestExitFullscreen]);

  const requestExit = React.useCallback(() => {
    if (isSaving) {
      return;
    }
    if (dirty) {
      setConfirmAction("exit");
      return;
    }
    doExit();
  }, [dirty, doExit, isSaving]);

  const handleConfirmAction = React.useCallback(() => {
    if (confirmAction === "cancel") {
      onRequestCancel();
    } else {
      doExit();
    }
    setConfirmAction(null);
  }, [confirmAction, doExit, onRequestCancel]);

  const handleSave = React.useCallback(async () => {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      const result = await onRequestSave();
      if (result !== false) {
        setLastSavedAt(new Date());
      }
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, onRequestSave]);

  useHotkeys({
    enabled: open,
    onEscape: () => {
      if (confirmAction) {
        setConfirmAction(null);
        return;
      }
      if (lightbox) {
        setLightbox(null);
        return;
      }
      requestExit();
    },
    onSave: () => {
      void handleSave();
    }
  });

  React.useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey) {
        return;
      }
      if (event.key === "1") {
        event.preventDefault();
        setMode("edit");
        return;
      }
      if (event.key === "2") {
        event.preventDefault();
        setMode("preview");
        return;
      }
      if (!isNarrow && event.key === "3") {
        event.preventDefault();
        setMode("live");
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isNarrow, open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const narrow = window.innerWidth < MIN_SPLIT_WIDTH;
    setIsNarrow(narrow);
    setMode(narrow ? "edit" : "live");
    setHelpOpen(false);
    setConfirmAction(null);
    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    const onResize = (): void => {
      const narrow = window.innerWidth < MIN_SPLIT_WIDTH;
      setIsNarrow(narrow);
      if (narrow && mode === "live") {
        setMode("edit");
      }
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [mode, open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => {
      const textarea = getEditorTextarea(overlayRef.current);
      restoreEditorSnapshot(textarea, initialSnapshot);
      lastSnapshotRef.current = captureEditorSnapshot(textarea);
      textarea?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [initialSnapshot, open]);

  React.useEffect(() => {
    if (!open || !overlayRef.current) {
      return;
    }
    const overlayNode = overlayRef.current;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") {
        return;
      }
      const focusable = getFocusableElements(overlayNode);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !overlayNode.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (active === last || !overlayNode.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    overlayNode.addEventListener("keydown", onKeyDown, true);
    return () => {
      overlayNode.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  React.useEffect(() => {
    window.localStorage.setItem(SPLIT_RATIO_KEY, splitRatio.toString());
  }, [splitRatio]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(DENSITY_KEY, density);
    } catch {
      // ignore write failure
    }
  }, [density]);

  const beginResize = React.useCallback((startEvent: React.PointerEvent<HTMLDivElement>) => {
    if (!splitRef.current) {
      return;
    }
    startEvent.preventDefault();
    const containerRect = splitRef.current.getBoundingClientRect();
    const onPointerMove = (event: PointerEvent): void => {
      const nextRatio = (event.clientX - containerRect.left) / containerRect.width;
      setSplitRatio(clamp(nextRatio, 0.3, 0.7));
    };
    const onPointerUp = (): void => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.classList.remove("annota-resizing");
    };
    document.body.classList.add("annota-resizing");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }, []);

  if (!open) {
    return null;
  }

  const activeMode: PreviewType = isNarrow && mode === "live" ? "edit" : mode;
  const container = document.body;
  const editorHeight = Math.max(window.innerHeight - 64 - 56 - 56, 340);
  const status = isSaving ? "saving" : dirty ? "dirty" : "saved";
  const statusText =
    status === "saving" ? "⏳ 正在保存…" : status === "dirty" ? "● 未保存更改" : `✓ 已保存 ${formatTime(lastSavedAt)}`;

  const editorPane = (
    <MDEditor
      data-color-mode="light"
      value={value}
      onChange={(next) => onChange(next ?? "")}
      preview="edit"
      height={editorHeight}
      visibleDragbar={false}
      highlightEnable={false}
      commands={commands}
      extraCommands={[]}
      previewOptions={{ rehypePlugins: [rehypeSanitize] }}
      textareaProps={{
        placeholder,
        rows,
        onMouseDown: (event) => event.stopPropagation(),
        onScroll: (event) => {
          const target = event.currentTarget as unknown as HTMLTextAreaElement;
          lastSnapshotRef.current = captureEditorSnapshot(target);
        },
        onSelect: (event) => {
          const target = event.currentTarget as unknown as HTMLTextAreaElement;
          lastSnapshotRef.current = captureEditorSnapshot(target);
        },
        onKeyDown: (event) => {
          event.stopPropagation();
          lastSnapshotRef.current = captureEditorSnapshot(event.currentTarget);
          onEditorKeyDown(event);
        }
      }}
      className="annota-uiw-editor annota-uiw-editor-fullscreen"
    />
  );

  const previewPane = (
    <div
      className="annota-fullscreen-preview-pane wmde-markdown-var"
      data-color-mode="light"
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (!target || target.tagName.toLowerCase() !== "img") {
          return;
        }
        const image = target as HTMLImageElement;
        const src = image.currentSrc || image.src;
        if (!src) {
          return;
        }
        setLightbox({ src, alt: image.alt || "preview-image" });
      }}
    >
      <div className="annota-fullscreen-preview-prose annota-markdown">
        <MDEditor.Markdown source={value} rehypePlugins={[rehypeSanitize]} data-color-mode="light" />
      </div>
    </div>
  );

  return createPortal(
    <div
      className="annota-fullscreen-overlay wmde-markdown-var"
      data-color-mode="light"
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
    >
      <div className="annota-fullscreen-mask" />
      <div
        className="annota-fullscreen-dialog"
        data-color-mode="light"
        data-density={density}
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
      >
        <header className="annota-fullscreen-topbar">
          <div className="annota-fullscreen-topbar-left">
            <button type="button" className="annota-fullscreen-topbar-icon-btn" onClick={requestExit} aria-label="关闭全屏">
              ×
            </button>
            <div className="annota-fullscreen-title-wrap">
              <div className="annota-fullscreen-title">{title}</div>
              {subtitle ? <div className="annota-fullscreen-subtitle">{subtitle}</div> : null}
            </div>
          </div>
          <div className="annota-fullscreen-mode-toggle" role="tablist" aria-label="编辑模式切换">
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "edit"}
              data-active={activeMode === "edit"}
              onClick={() => {
                setMode("edit");
                window.setTimeout(() => focusEditor(), 0);
              }}
            >
              Write
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "preview"}
              data-active={activeMode === "preview"}
              onClick={() => setMode("preview")}
            >
              Preview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === "live"}
              data-active={activeMode === "live"}
              disabled={isNarrow}
              onClick={() => setMode("live")}
            >
              Split
            </button>
          </div>
          <div className="annota-fullscreen-topbar-right">
            <div className="annota-fullscreen-density-toggle" role="group" aria-label="字号密度切换">
              <button type="button" data-active={density === "compact"} onClick={() => setDensity("compact")}>
                小
              </button>
              <button type="button" data-active={density === "comfortable"} onClick={() => setDensity("comfortable")}>
                中
              </button>
              <button type="button" data-active={density === "large"} onClick={() => setDensity("large")}>
                大
              </button>
            </div>
            <div className="annota-fullscreen-help-wrap">
              <button
                type="button"
                className="annota-fullscreen-topbar-icon-btn"
                onClick={() => setHelpOpen((value) => !value)}
                aria-label="快捷键帮助"
              >
                ?
              </button>
              {helpOpen ? (
                <div className="annota-fullscreen-help-panel">
                  <div>Esc：退出全屏</div>
                  <div>Ctrl/Cmd + S：保存</div>
                  <div>Alt + 1/2/3：Write/Preview/Split</div>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="annota-fullscreen-main">
          <div className="annota-fullscreen-editor-wrap">
            {activeMode === "edit" ? (
              <div className="annota-fullscreen-single">{editorPane}</div>
            ) : null}
            {activeMode === "preview" ? (
              <div className="annota-fullscreen-single">{previewPane}</div>
            ) : null}
            {activeMode === "live" ? (
              <div
                className="annota-fullscreen-split"
                ref={splitRef}
                style={{ gridTemplateColumns: `${Math.round(splitRatio * 100)}% 10px minmax(0, 1fr)` }}
              >
                <div className="annota-fullscreen-split-pane">{editorPane}</div>
                <div
                  className="annota-fullscreen-divider"
                  role="separator"
                  aria-orientation="vertical"
                  onPointerDown={beginResize}
                />
                <div className="annota-fullscreen-split-pane">{previewPane}</div>
              </div>
            ) : null}
          </div>
        </main>
        <footer className="annota-fullscreen-bottombar">
          <div className="annota-fullscreen-status" data-state={status}>
            <span>字数: {countCharacters(value)}</span>
            <span>{statusText}</span>
          </div>
          <div className="annota-fullscreen-actions">
            <button
              type="button"
              data-kind="ghost"
              onClick={() => {
                if (dirty) {
                  setConfirmAction("cancel");
                  return;
                }
                onRequestCancel();
              }}
            >
              放弃更改
            </button>
            <button type="button" data-kind="primary" disabled={isSaving || !dirty} onClick={() => void handleSave()}>
              {isSaving ? "保存中…" : saveLabel}
            </button>
          </div>
        </footer>
      </div>
      {confirmAction ? (
        <div className="annota-fullscreen-confirm-mask" onMouseDown={(event) => event.stopPropagation()}>
          <div className="annota-fullscreen-confirm">
            <div className="annota-fullscreen-confirm-title">
              {confirmAction === "cancel" ? "有未保存更改，确定放弃？" : "有未保存更改，确定退出？"}
            </div>
            <div className="annota-fullscreen-confirm-desc">退出后将丢失本次全屏编辑中的未保存内容。</div>
            <div className="annota-fullscreen-confirm-actions">
              <button type="button" data-kind="ghost" onClick={() => setConfirmAction(null)}>
                继续编辑
              </button>
              <button type="button" data-kind="danger" onClick={handleConfirmAction}>
                {confirmAction === "cancel" ? "放弃更改" : "退出并放弃"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {lightbox ? (
        <div className="annota-fullscreen-lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox.src} alt={lightbox.alt} />
        </div>
      ) : null}
    </div>,
    container
  );
};
