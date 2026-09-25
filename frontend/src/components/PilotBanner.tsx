"use client";

import { useEffect, useState } from "react";
import { feedbackMailto, whatsappPilotMessage } from "@/lib/pilot";

const STORAGE_KEY = "shibutz_pilot_banner_dismissed";

export function PilotBanner() {
  const [expanded, setExpanded] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setExpanded(localStorage.getItem(STORAGE_KEY) !== "1");
    } catch {
      setExpanded(true);
    }
    setReady(true);
  }, []);

  function collapse() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setExpanded(false);
  }

  function expand() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setExpanded(true);
  }

  function shareWhatsApp() {
    const text = encodeURIComponent(whatsappPilotMessage());
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  }

  if (!ready) {
    return <aside className="pilot-banner pilot-banner--pending" aria-hidden />;
  }

  if (!expanded) {
    return (
      <aside className="pilot-banner pilot-banner--collapsed" aria-label="מדריך פיילוט">
        <button
          type="button"
          className="pilot-banner-chip"
          onClick={expand}
          aria-label="הצג באנר פיילוט"
          title="פיילוט"
        >
          פיילוט
        </button>
      </aside>
    );
  }

  return (
    <aside className="pilot-banner" aria-label="מדריך פיילוט">
      <p className="pilot-banner-line">
        <strong>פיילוט</strong>
        <span className="pilot-banner-sep" aria-hidden>
          ·
        </span>
        <span>
          כוח אדם → הגדרות → שיבוץ → פרסום · אחרי שבוע שלחו פידבק
        </span>
      </p>
      <div className="pilot-banner-actions">
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={shareWhatsApp}
        >
          וואטסאפ
        </button>
        <a className="btn btn-ghost btn-small" href={feedbackMailto()}>
          פידבק
        </a>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={collapse}
          aria-label="כווץ באנר פיילוט"
        >
          ×
        </button>
      </div>
    </aside>
  );
}
