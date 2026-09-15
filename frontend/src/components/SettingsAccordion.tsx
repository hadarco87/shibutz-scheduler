"use client";

import { ReactNode } from "react";

export function SettingsAccordion({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <details className="settings-accordion panel">
      <summary className="settings-accordion-summary">
        <span className="settings-accordion-heading">
          <span className="settings-accordion-title">{title}</span>
          {hint ? <span className="settings-accordion-hint">{hint}</span> : null}
        </span>
      </summary>
      <div className="settings-accordion-body">{children}</div>
    </details>
  );
}
