"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ConfirmTone = "default" | "danger" | "accent";

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return fn;
}

type Pending = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const titleId = useId();
  const descId = useId();
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      if (pendingRef.current) {
        pendingRef.current.resolve(false);
      }
      const normalized: ConfirmOptions =
        typeof options === "string" ? { message: options } : options;
      const next: Pending = { ...normalized, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const close = useCallback((value: boolean) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(value);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      }
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => confirmBtnRef.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [pending, close]);

  const tone = pending?.tone || "default";
  const confirmClass =
    tone === "danger"
      ? "btn btn-danger"
      : tone === "accent"
        ? "btn btn-accent btn-small"
        : "btn btn-primary btn-small";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? (
        <div
          className="app-dialog-backdrop"
          role="presentation"
          onClick={() => close(false)}
        >
          <div
            className={`app-dialog${tone === "danger" ? " app-dialog-danger" : ""}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={pending.title ? titleId : undefined}
            aria-describedby={descId}
            onClick={(e) => e.stopPropagation()}
          >
            {pending.title ? (
              <h2 id={titleId} className="app-dialog-title">
                {pending.title}
              </h2>
            ) : null}
            <p id={descId} className="app-dialog-message">
              {pending.message}
            </p>
            <div className="app-dialog-actions">
              <button
                className="btn btn-ghost btn-small"
                type="button"
                onClick={() => close(false)}
              >
                {pending.cancelLabel || "ביטול"}
              </button>
              <button
                ref={confirmBtnRef}
                className={confirmClass}
                type="button"
                onClick={() => close(true)}
              >
                {pending.confirmLabel || "אישור"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}
