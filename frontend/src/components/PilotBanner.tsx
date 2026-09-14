"use client";

import { useEffect, useState } from "react";
import {
  feedbackMailto,
  whatsappPilotMessage,
} from "@/lib/pilot";

const STORAGE_KEY = "shibutz_pilot_banner_dismissed";

export function PilotBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== "1") setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  if (!open) return null;

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  function shareWhatsApp() {
    const text = encodeURIComponent(whatsappPilotMessage());
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  }

  return (
    <aside className="pilot-banner" aria-label="מדריך פיילוט">
      <div className="pilot-banner-text">
        <strong>פיילוט — התחלה מהירה</strong>
        <span>
          1) כוח אדם → 2) הגדרות משימות → 3) שיבוץ והפעלה → 4) מאושר לפרסום.
          אחרי שבוע שלחו פידבק.
        </span>
      </div>
      <div className="pilot-banner-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={shareWhatsApp}>
          שתפו בוואטסאפ
        </button>
        <a className="btn btn-ghost btn-small" href={feedbackMailto()}>
          שלחו פידבק
        </a>
        <button type="button" className="btn btn-ghost btn-small" onClick={dismiss}>
          סגור
        </button>
      </div>
    </aside>
  );
}
