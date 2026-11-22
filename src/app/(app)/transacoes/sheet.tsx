"use client";
import { useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "@/components/ui";

/**
 * Native modal dialog: the browser contains focus, closes on Escape and returns focus to the trigger. Bottom sheet on
 * phones, centered panel from `sm`. Clicking outside does nothing, so a half-filled panel is never lost by accident.
 */
export function Sheet({ label, title, children, triggerClassName, ariaLabel }: { label: ReactNode; title: string; children: ReactNode; triggerClassName?: string; ariaLabel?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-label={ariaLabel} onClick={() => ref.current?.showModal()} className={triggerClassName}>
        {label}
      </button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        // A link inside navigates without reloading, so the modal would stay open over the new page.
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) ref.current?.close();
        }}
        className={cx(
          "fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-3xl border border-border bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-text shadow-pop backdrop:bg-black/55 backdrop:backdrop-blur-[2px]",
          "sm:inset-0 sm:m-auto sm:h-fit sm:max-w-md sm:rounded-3xl sm:p-6",
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Fechar" className="-mr-2 flex size-11 items-center justify-center rounded-xl text-muted hover:bg-surface-3 hover:text-text">
            <X aria-hidden size={18} />
          </button>
        </div>
        {children}
      </dialog>
    </>
  );
}
