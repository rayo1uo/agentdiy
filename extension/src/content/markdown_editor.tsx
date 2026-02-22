import React from "react";
import { createRoot, type Root } from "react-dom/client";
import MDEditor, { commands, type ICommand, type PreviewType } from "@uiw/react-md-editor";
import rehypeSanitize from "rehype-sanitize";
import { FullscreenMarkdownEditor, type EditorSnapshot } from "./FullscreenMarkdownEditor";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

export type MarkdownEditorWidget = {
  container: HTMLDivElement;
  getValue: () => string;
  focus: () => void;
  onInput: (listener: (value: string) => void) => () => void;
  onKeyDown: (listener: (event: KeyboardEvent) => void) => () => void;
  setOnSaveRequest: (listener: (() => Promise<boolean | void> | boolean | void) | null) => void;
  setOnCancelRequest: (listener: (() => void) | null) => void;
  markSaved: (value?: string) => void;
  destroy: () => void;
};

type MarkdownEditorWidgetOptions = {
  placeholder: string;
  rows: number;
  initialValue?: string;
};

export const createMarkdownEditorWidget = (options: MarkdownEditorWidgetOptions): MarkdownEditorWidget => {
  const container = document.createElement("div");
  container.className = "annota-comment-editor annota-comment-editor-uiw";
  container.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });

  const inputListeners = new Set<(value: string) => void>();
  const keyDownListeners = new Set<(event: KeyboardEvent) => void>();
  let root: Root | null = createRoot(container);
  let currentValue = options.initialValue ?? "";
  let committedValue = currentValue;
  let currentMode: PreviewType = "edit";
  let fullscreenOpen = false;
  let mounted = true;
  let setModeRef: ((next: PreviewType) => void) | null = null;
  let setCommittedValueRef: ((next: string) => void) | null = null;
  let requestSaveRef: (() => Promise<boolean | void> | boolean | void) | null = null;
  let requestCancelRef: (() => void) | null = null;

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

  const applyValue = (next: string): void => {
    currentValue = next;
    for (const listener of inputListeners) {
      listener(next);
    }
  };

  const handleFocus = (): void => {
    const textarea =
      document.querySelector<HTMLTextAreaElement>(".annota-fullscreen-overlay textarea.w-md-editor-text-input") ??
      container.querySelector<HTMLTextAreaElement>("textarea.w-md-editor-text-input");
    textarea?.focus();
  };

  const toolbarCommands = [
    commands.bold,
    commands.italic,
    commands.quote,
    commands.link,
    commands.image,
    commands.code,
    commands.orderedListCommand,
    commands.unorderedListCommand
  ];

  const fullscreenToolbarCommands = [
    commands.bold,
    commands.italic,
    commands.strikethrough,
    commands.quote,
    commands.link,
    commands.image,
    commands.code,
    commands.codeBlock,
    commands.hr,
    commands.orderedListCommand,
    commands.unorderedListCommand,
    commands.checkedListCommand,
    commands.table,
    commands.help
  ];

  const EditorHost = (): JSX.Element => {
    const [value, setValue] = React.useState(currentValue);
    const [mode, setMode] = React.useState<PreviewType>("edit");
    const [isFullscreenOpen, setFullscreenOpen] = React.useState(false);
    const [committed, setCommitted] = React.useState(committedValue);
    const [fullscreenInitialSnapshot, setFullscreenInitialSnapshot] = React.useState<EditorSnapshot | null>(null);

    React.useEffect(() => {
      setModeRef = (next: PreviewType) => {
        setMode(next);
        currentMode = next;
      };
      return () => {
        setModeRef = null;
      };
    }, []);

    React.useEffect(() => {
      setCommittedValueRef = (next: string) => {
        committedValue = next;
        setCommitted(next);
      };
      return () => {
        setCommittedValueRef = null;
      };
    }, []);

    const emitNativeKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      for (const listener of keyDownListeners) {
        listener(event.nativeEvent);
      }
    }, []);

    const openFullscreen = React.useCallback(() => {
      const inlineTextarea = container.querySelector<HTMLTextAreaElement>("textarea.w-md-editor-text-input");
      setFullscreenInitialSnapshot(captureEditorSnapshot(inlineTextarea));
      fullscreenOpen = true;
      setFullscreenOpen(true);
    }, []);

    const closeFullscreen = React.useCallback((snapshot: EditorSnapshot | null) => {
      fullscreenOpen = false;
      setFullscreenOpen(false);
      window.setTimeout(() => {
        if (snapshot) {
          const inlineTextarea = container.querySelector<HTMLTextAreaElement>("textarea.w-md-editor-text-input");
          restoreEditorSnapshot(inlineTextarea, snapshot);
        }
        handleFocus();
      }, 0);
    }, []);

    const onChange = (next?: string): void => {
      const normalized = next ?? "";
      setValue(normalized);
      applyValue(normalized);
    };

    const requestSave = React.useCallback(async (): Promise<boolean> => {
      const result = await requestSaveRef?.();
      const successful = result !== false;
      if (successful) {
        const current = currentValue;
        committedValue = current;
        setCommittedValueRef?.(current);
      }
      return successful;
    }, []);

    const requestCancel = React.useCallback(() => {
      requestCancelRef?.();
    }, []);

    const modeCommands = React.useMemo<ICommand[]>(
      () => [
        {
          name: "fullscreenOverlay",
          keyCommand: "preview",
          value: mode,
          buttonProps: {
            "aria-label": "全屏编辑",
            title: "全屏编辑",
            className: "annota-uiw-fullscreen-command-btn"
          },
          icon: <span className="annota-uiw-fullscreen-command-label">⛶</span>,
          execute: () => {
            openFullscreen();
          }
        },
        commands.divider,
        {
          ...commands.codeEdit,
          name: "write",
          keyCommand: "preview",
          value: "edit",
          buttonProps: {
            ...commands.codeEdit.buttonProps,
            className: "annota-uiw-mode-command-btn",
            "aria-label": "Write",
            title: "Write"
          },
          icon: <span className="annota-uiw-mode-command-label">Write</span>,
          execute: () => {
            setMode("edit");
            currentMode = "edit";
            window.setTimeout(() => handleFocus(), 0);
          }
        },
        {
          ...commands.codePreview,
          name: "preview",
          keyCommand: "preview",
          value: "preview",
          buttonProps: {
            ...commands.codePreview.buttonProps,
            className: "annota-uiw-mode-command-btn",
            "aria-label": "Preview",
            title: "Preview"
          },
          icon: <span className="annota-uiw-mode-command-label">Preview</span>,
          execute: () => {
            setMode("preview");
            currentMode = "preview";
          }
        }
      ],
      [mode, openFullscreen]
    );

    return (
      <>
        <div className="annota-uiw-editor-shell" data-color-mode="light" onMouseDown={(event) => event.stopPropagation()}>
          <MDEditor
            data-color-mode="light"
            value={value}
            onChange={onChange}
            preview={mode}
            height={Math.max(options.rows * 34, 170)}
            visibleDragbar={false}
            highlightEnable={false}
            commands={toolbarCommands}
            extraCommands={modeCommands}
            previewOptions={{ rehypePlugins: [rehypeSanitize] }}
            textareaProps={{
              placeholder: options.placeholder,
              rows: options.rows,
              onMouseDown: (event) => event.stopPropagation(),
              onKeyDown: (event) => {
                event.stopPropagation();
                emitNativeKeyDown(event);
              }
            }}
            className="annota-uiw-editor"
          />
        </div>
        <FullscreenMarkdownEditor
          open={isFullscreenOpen}
          title="编辑评论"
          value={value}
          placeholder={options.placeholder}
          rows={Math.max(options.rows + 2, 6)}
          commands={fullscreenToolbarCommands}
          dirty={value !== committed}
          saveLabel="保存评论"
          onChange={(next) => {
            setValue(next);
            applyValue(next);
          }}
          onEditorKeyDown={(event) => {
            emitNativeKeyDown(event);
          }}
          onRequestSave={requestSave}
          onRequestCancel={requestCancel}
          onRequestExitFullscreen={closeFullscreen}
          initialSnapshot={fullscreenInitialSnapshot}
        />
      </>
    );
  };

  root.render(<EditorHost />);

  return {
    container,
    getValue: () => currentValue,
    focus: () => {
      if (fullscreenOpen) {
        handleFocus();
        return;
      }
      if (currentMode === "preview") {
        setModeRef?.("edit");
        currentMode = "edit";
        window.setTimeout(() => handleFocus(), 0);
        return;
      }
      handleFocus();
    },
    onInput: (listener) => {
      inputListeners.add(listener);
      return () => {
        inputListeners.delete(listener);
      };
    },
    onKeyDown: (listener) => {
      keyDownListeners.add(listener);
      return () => {
        keyDownListeners.delete(listener);
      };
    },
    setOnSaveRequest: (listener) => {
      requestSaveRef = listener;
    },
    setOnCancelRequest: (listener) => {
      requestCancelRef = listener;
    },
    markSaved: (value) => {
      const next = value ?? currentValue;
      committedValue = next;
      setCommittedValueRef?.(next);
    },
    destroy: () => {
      if (!mounted) {
        return;
      }
      mounted = false;
      inputListeners.clear();
      keyDownListeners.clear();
      requestSaveRef = null;
      requestCancelRef = null;
      root?.unmount();
      root = null;
      setModeRef = null;
      setCommittedValueRef = null;
    }
  };
};
