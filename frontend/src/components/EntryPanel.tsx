import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider";
export function EntryPanel({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const observer = new MutationObserver(focus);
    function focus() {
      const field = ref.current?.querySelector<HTMLElement>(
        "input,select,textarea",
      );
      if (field) {
        field.focus();
        observer.disconnect();
      }
    }
    if (ref.current)
      observer.observe(ref.current, { childList: true, subtree: true });
    focus();
    return () => {
      observer.disconnect();
      trigger?.focus();
    };
  }, []);
  return (
    <div ref={ref} className="entry-panel">
      {children}
      <button type="button" onClick={onClose}>
        {t("Cancel entry")}
      </button>
    </div>
  );
}
