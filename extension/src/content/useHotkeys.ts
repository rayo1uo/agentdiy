import React from "react";

type UseHotkeysOptions = {
  enabled: boolean;
  onEscape?: () => void;
  onSave?: () => void;
};

export const useHotkeys = ({ enabled, onEscape, onSave }: UseHotkeysOptions): void => {
  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscape?.();
        return;
      }

      const isSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";
      if (isSave) {
        event.preventDefault();
        event.stopPropagation();
        onSave?.();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [enabled, onEscape, onSave]);
};

