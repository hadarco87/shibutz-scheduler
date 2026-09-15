"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, InvitePreview } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Mode = "login" | "register" | "invite";

export default function LoginForm() {
  const { login, register, registerInvite, token, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite") || "";
  const [mode, setMode] = useState<Mode>(inviteToken ? "invite" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (inviteToken) {
      setMode("invite");
      return;
    }
    if (
      searchParams.get("register") === "1" ||
      searchParams.get("mode") === "register"
    ) {
      setMode("register");
    }
  }, [searchParams, inviteToken]);

  useEffect(() => {
    if (!inviteToken) {
      setInvitePreview(null);
      return;
    }
    let cancelled = false;
    api
      .previewInvite(inviteToken)
      .then((preview) => {
        if (cancelled) return;
        setInvitePreview(preview);
        setEmail(preview.email);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setInvitePreview(null);
        setError(err instanceof Error ? err.message : "ההזמנה לא תקפה");
      });
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  useEffect(() => {
    if (!loading && token) router.replace("/");
  }, [loading, token, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "login") {
        await login(email, password);
      } else if (mode === "invite") {
        if (!inviteToken) throw new Error("חסר קוד הזמנה");
        await registerInvite({
          token: inviteToken,
          email,
          password,
          full_name: fullName,
        });
      } else {
        await register({
          email,
          password,
          full_name: fullName,
          company_name: companyName,
        });
      }
      router.replace("/");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : mode === "login"
            ? "התחברות נכשלה"
            : "הרשמה נכשלה"
      );
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    if (next === "invite") return;
    setMode(next);
    setError("");
  }

  const title =
    mode === "login"
      ? "כניסה"
      : mode === "invite"
        ? "הצטרפות לפלוגה"
        : "הרשמת פלוגה";

  const subtitle =
    mode === "login"
      ? "התחברו לחשבון הפלוגה שלכם"
      : mode === "invite"
        ? invitePreview
          ? `מצטרפים ל«${invitePreview.company_name}» עם הרשאות מלאות`
          : "טוענים הזמנה..."
        : "צרו חשבון חדש — אתם מנהלי הפלוגה";

  return (
    <div className="login-wrap">
      <div className="login-layout">
        <section className="login-pitch" aria-label="על המוצר">
          <p className="login-pilot-badge">פיילוט פתוח למפקדי שיבוץ</p>
          <h1>שיבוץ</h1>
          <p className="login-lead">
            נרשמים באימייל, כל פלוגה בחשבון נפרד, שיבוץ אוטומטי ל־24 השעות
            הקרובות.
          </p>
          <ul className="login-bullets">
            <li>כוח אדם, משימות ומגבלות במקום אחד</li>
            <li>הצעת שיבוץ + אישור לפרסום (רק אז נשמרת היסטוריה)</li>
            <li>הנתונים של הפלוגה שלכם לא נראים לפלוגות אחרות</li>
          </ul>
          <p className="login-pitch-foot">
            משתמשים בפיילוט? שלחו פידבק אחרי שבוע שימוש אמיתי — זה מה שמשפר את
            המוצר.
          </p>
        </section>

        <form className="login-card form-grid" onSubmit={onSubmit}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.35rem" }}>{title}</h2>
            <p>{subtitle}</p>
          </div>

          {mode !== "invite" ? (
            <div className="login-tabs" role="tablist" aria-label="מצב כניסה">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={mode === "login" ? "is-active" : ""}
                onClick={() => switchMode("login")}
              >
                כניסה
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                className={mode === "register" ? "is-active" : ""}
                onClick={() => switchMode("register")}
              >
                הרשמה
              </button>
            </div>
          ) : null}

          {mode === "register" ? (
            <label>
              שם הפלוגה / היחידה
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                autoComplete="organization"
                placeholder="לדוגמה: פלוגה ב׳"
              />
            </label>
          ) : null}

          {mode === "register" || mode === "invite" ? (
            <label>
              שם מלא
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoComplete="name"
              />
            </label>
          ) : null}

          <label>
            אימייל
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              readOnly={mode === "invite"}
              autoComplete="username"
            />
          </label>
          <label>
            סיסמה
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              minLength={mode === "login" ? undefined : 8}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </label>
          {mode === "register" ? (
            <p className="login-hint">לפחות 8 תווים. החשבון יהיה מנהל הפלוגה.</p>
          ) : null}
          {mode === "invite" ? (
            <p className="login-hint">
              לפחות 8 תווים. לאחר ההרשמה תקבלו גישה מלאה לפלוגה
              {invitePreview?.invited_by_name
                ? ` (הוזמנתם על ידי ${invitePreview.invited_by_name})`
                : ""}
              .
            </p>
          ) : null}

          {error ? <div className="alert alert-danger">{error}</div> : null}
          <button
            className="btn btn-primary"
            disabled={busy || (mode === "invite" && !invitePreview)}
            type="submit"
          >
            {busy
              ? mode === "login"
                ? "מתחבר..."
                : "נרשם..."
              : mode === "login"
                ? "כניסה"
                : mode === "invite"
                  ? "הצטרפות לפלוגה"
                  : "יצירת חשבון"}
          </button>
        </form>
      </div>
    </div>
  );
}
