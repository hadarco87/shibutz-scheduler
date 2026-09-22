"use client";

import { ReactNode } from "react";

export function SettingsAccordion({
  title,
  hint,
  badge,
  children,
}: {
  title: string;
  hint?: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <details className="settings-accordion panel panel-action">
      <summary className="settings-accordion-summary">
        <span className="settings-accordion-heading">
          {badge ? (
            <span className="settings-accordion-badge">{badge}</span>
          ) : null}
          <span className="settings-accordion-title">{title}</span>
          {hint ? <span className="settings-accordion-hint">{hint}</span> : null}
        </span>
      </summary>
      <div className="settings-accordion-body">{children}</div>
    </details>
  );
}
