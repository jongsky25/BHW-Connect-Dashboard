"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Reusable "enlarge" modal built on the native <dialog> element — focus trap
 * and focus restore come free with showModal()/close(), and Escape closes it
 * natively. No modal library needed (matches the repo's native-elements-first
 * convention, e.g. components/glossary/glossary-term.tsx).
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="fixed inset-0 m-auto flex h-[92vh] w-[96vw] max-w-6xl flex-col rounded-lg border border-border bg-background p-0 shadow-xl backdrop:bg-foreground/40"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md px-2 py-1 text-muted hover:bg-surface"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
    </dialog>
  );
}
