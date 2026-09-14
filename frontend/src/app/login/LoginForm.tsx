"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";

type Mode = "login" | "register";

export default function LoginForm() {
  const { login, register, token, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (
      searchParams.get("register") === "1" ||
      searchParams.get("mode") === "register"
    ) {
      setMode("register");
    }
  }, [searchParams]);

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
    setMode(next);
    setError("");
  }

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
            <h2 style={{ margin: 0, fontSize: "1.35rem" }}>
              {mode === "login" ? "כניסה" : "הרשמת פלוגה"}
            </h2>
            <p>
              {mode === "login"
                ? "התחברו לחשבון הפלוגה שלכם"
                : "צרו חשבון חדש — אתם מנהלי הפלוגה"}
            </p>
          </div>

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

          {mode === "register" ? (
            <>
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
              <label>
                שם מלא
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </label>
            </>
          ) : null}

          <label>
            אימייל
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
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
              minLength={mode === "register" ? 8 : undefined}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </label>
          {mode === "register" ? (
            <p className="login-hint">לפחות 8 תווים. החשבון יהיה מנהל הפלוגה.</p>
          ) : null}

          {error ? <div className="alert alert-danger">{error}</div> : null}
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy
              ? mode === "login"
                ? "מתחבר..."
                : "נרשם..."
              : mode === "login"
                ? "כניסה"
                : "יצירת חשבון"}
          </button>
        </form>
      </div>
    </div>
  );
}
