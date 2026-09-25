/** Soft-launch / pilot copy for sharing and in-app CTAs. */

export const PILOT_ONE_LINER =
  "נרשמים באימייל, כל פלוגה בחשבון נפרד, שיבוץ אוטומטי ל־24 השעות הקרובות.";

export const FEEDBACK_EMAIL =
  process.env.NEXT_PUBLIC_FEEDBACK_EMAIL || "hadarc@live.com";

/**
 * Public production URL. Never fall back to window.location.origin: Vercel
 * preview/branch URLs are behind Vercel login, so sharing them locks people out.
 */
const DEFAULT_PUBLIC_URL = "https://shibutz-scheduler-six.vercel.app";

export function appPublicUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || DEFAULT_PUBLIC_URL).replace(
    /\/$/,
    ""
  );
}

export function registerUrl() {
  return `${appPublicUrl()}/login?register=1`;
}

export function whatsappPilotMessage() {
  const url = registerUrl();
  return (
    `היי, בניתי כלי קטן לשיבוץ משימות בפלוגה (פיילוט).\n\n` +
    `${PILOT_ONE_LINER}\n\n` +
    `להרשמה (חינם לבינתיים):\n${url}\n\n` +
    `אם תנסו שבוע ותכתבו לי מה עבד/מה חסר — זה יעזור מאוד.`
  );
}

export function feedbackMailto(subject = "פידבק שיבוץ — פיילוט") {
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
