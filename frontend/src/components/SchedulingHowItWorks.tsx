"use client";

import { useEffect, useId, useRef, useState } from "react";

export function SchedulingHowItWorksButton() {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="how-it-works-trigger"
        aria-label="איך עובד השיבוץ"
        title="איך עובד השיבוץ"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">?</span>
        <span className="how-it-works-trigger-label">איך עובד השיבוץ</span>
      </button>

      {open ? (
        <div
          className="how-it-works-backdrop"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            className="how-it-works-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="how-it-works-header">
              <div>
                <p className="how-it-works-kicker">מסך שיבוץ</p>
                <h2 id={titleId}>איך עובד השיבוץ</h2>
              </div>
              <button
                ref={closeBtnRef}
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => setOpen(false)}
              >
                סגור
              </button>
            </header>

            <div className="how-it-works-body">
              <section className="how-it-works-section how-it-works-lead">
                <h3>בקצרה</h3>
                <p>
                  המערכת לא «מנחשת». היא עוברת משימה־משימה, בודקת מי{" "}
                  <strong>מותר</strong> לשבץ, ואז בוחרת מבין המותרים את מי
                  שמתאים ביותר לפי סדר עדיפויות ברור:
                </p>
                <p className="how-it-works-priority">
                  בטיחות וזמינות קודם ← הוגנות עומס ← ניצול מינימום נדרש של
                  מפקדים למשימה
                </p>
                <p>
                  חשוב: לחיצה על «שבץ אותי» יוצרת <strong>הצעה בטיוטה</strong>.
                  רק «מאושר לפרסום» מקבע את השיבוץ ומעדכן את מדד העומס.
                </p>
              </section>

              <section className="how-it-works-section">
                <h3>חוקים קשיחים — אסור לשבור</h3>
                <p>אדם לא ייכנס למשבצת אם:</p>
                <ul>
                  <li>הוא מושעה / לא פעיל</li>
                  <li>הוא בחופשה או בהיעדרות בזמן המשימה</li>
                  <li>
                    יש עליו מגבלה (חד־פעמית או רוטינית) שחוסמת את המשימה
                  </li>
                  <li>
                    אין לו את <strong>התפקיד</strong> הנדרש למשבצת (או יכולת
                    למלא אותו)
                  </li>
                  <li>
                    חסר לו <strong>הפק״ל</strong> הנדרש
                  </li>
                  <li>
                    הוא מוגבל רק לסוגי משימות מסוימים — והמשימה הזו לא ביניהם
                  </li>
                  <li>הוא כבר משובץ במשימה חופפת באותו חלון</li>
                  <li>
                    לא נשארה לו <strong>מנוחה מינימלית</strong> לפני המשימה
                    (לפי ההגדרה שלכם)
                  </li>
                </ul>
                <p className="how-it-works-note">
                  אם אין אף מועמד שעומד בכל החוקים — המשבצת נשארת חסרה, ותקבלו
                  הסבר ברור מה היה חסר.
                </p>
              </section>

              <section className="how-it-works-section">
                <h3>העדפות רכות — בין מי שמותר</h3>
                <p>כשיש כמה מועמדים כשרים, המערכת מעדיפה לפי הסדר הזה:</p>
                <ol>
                  <li>
                    <strong>מי שקיבל פחות אפטרים לאחרונה</strong> — כדי לא
                    להעמיס שוב על מי שכבר יצא
                  </li>
                  <li>
                    <strong>מי עם מדד עומס היסטורי נמוך יותר</strong> — עומס =
                    קושי המשימה × שעות שירות, ורק משיבוצים שכבר{" "}
                    <strong>פורסמו</strong>
                  </li>
                  <li>
                    <strong>ניצול מינימום נדרש של מפקדים למשימה</strong> — אם
                    חייל יכול למלא את המשבצת, הוא יועדף; מפקד/קצין יוצבים רק
                    כשהמשבצת באמת דורשת אותם, או כשאין חייל מתאים
                  </li>
                  <li>
                    <strong>פיזור בתוך אותו חלון</strong> — מי שכבר שובץ
                    במשימות אחרות באותו חלון יקבל עדיפות נמוכה יותר
                  </li>
                </ol>
              </section>

              <section className="how-it-works-section">
                <h3>איך זה קורה בפועל</h3>
                <ol className="how-it-works-steps">
                  <li>
                    <strong>בונים את חלון השיבוץ</strong> — משימות הרוטינה
                    והמשימות שבחרתם נכנסות לחלון (היום / מחר).
                  </li>
                  <li>
                    <strong>מפרקים כל משימה למשבצות</strong> — למשל: מפקד אחד,
                    חובש אחד, חייל אחד.
                  </li>
                  <li>
                    <strong>עובדים לפי סדר</strong> — מהמשימות הקודמות בזמן,
                    ובתוך כך מהקשות יותר קודם.
                  </li>
                  <li>
                    <strong>לכל משבצת:</strong> מסננים מי אסור → מדרגים מי
                    מותר → בוחרים את המועמד הטוב ביותר.
                  </li>
                  <li>
                    <strong>מציגים טיוטה</strong> — אפשר להחליף ידנית, לבדוק
                    קונפליקטים, ורק אז לפרסם.
                  </li>
                </ol>
              </section>

              <section className="how-it-works-section">
                <h3>מה זה אומר בפועל</h3>
                <dl className="how-it-works-glossary">
                  <div>
                    <dt>שיבוץ «חסר איוש»</dt>
                    <dd>לא נמצא מועמד שעומד בחוקים הקשיחים</dd>
                  </div>
                  <div>
                    <dt>מפקד במשבצת חייל</dt>
                    <dd>בדרך כלל רק אם לא נשאר חייל מתאים</dd>
                  </div>
                  <div>
                    <dt>מישהו עם עומס גבוה עדיין משובץ</dt>
                    <dd>כי האחרים היו חסומים (חופשה / פק״ל / חפיפה)</dd>
                  </div>
                  <div>
                    <dt>אחרי «שבץ אותי» העומס לא עלה</dt>
                    <dd>נכון — עומס מתעדכן רק בפרסום</dd>
                  </div>
                </dl>
              </section>

              <section className="how-it-works-section how-it-works-gold">
                <h3>עקרון הזהב</h3>
                <p>
                  <strong>
                    המערכת ממלאת קודם את מה שחייבים, ורק אחר כך מנסה להיות
                    הוגנת.
                  </strong>{" "}
                  היא לא מחליפה שיקול דעת של מפקד — היא נותנת הצעה מהירה
                  ושקופה, ואתם מאשרים.
                </p>
              </section>
            </div>

            <footer className="how-it-works-footer">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setOpen(false)}
              >
                הבנתי
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
