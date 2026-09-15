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
                  <strong>מותר</strong> לשבץ, ואז בוחרת מבין המותרים לפי סדר
                  עדיפויות ברור.
                </p>
                <ol className="how-it-works-priority-flow" aria-label="סדר עדיפויות">
                  <li>
                    <span className="how-it-works-priority-num">1</span>
                    <span>
                      <strong>זמינות וכשירות</strong>
                      <em>חוקים קשיחים</em>
                    </span>
                  </li>
                  <li>
                    <span className="how-it-works-priority-num">2</span>
                    <span>
                      <strong>אפטר</strong>
                      <em>מי שנח יותר</em>
                    </span>
                  </li>
                  <li>
                    <span className="how-it-works-priority-num">3</span>
                    <span>
                      <strong>הוגנות עומס</strong>
                      <em>קושי × שעות</em>
                    </span>
                  </li>
                  <li>
                    <span className="how-it-works-priority-num">4</span>
                    <span>
                      <strong>מפקדים</strong>
                      <em>מינימום נדרש</em>
                    </span>
                  </li>
                </ol>
                <p className="how-it-works-callout">
                  «שבץ אותי» יוצר <strong>הצעה בטיוטה</strong> בלבד. רק «מאושר
                  לפרסום» מקבע את השיבוץ ומעדכן את מדד העומס.
                </p>
              </section>

              <section className="how-it-works-section">
                <h3>חוקים קשיחים — אסור לשבור</h3>
                <p className="how-it-works-section-lead">
                  אדם לא ייכנס למשבצת אם אחד מאלה נכון:
                </p>
                <ul className="how-it-works-rule-list">
                  <li>
                    <strong>סטטוס</strong>
                    <span>מושעה / לא פעיל בכוח האדם</span>
                  </li>
                  <li>
                    <strong>חופשה / היעדרות</strong>
                    <span>בזמן המשימה (כולל אפטר שכבר אושר)</span>
                  </li>
                  <li>
                    <strong>מגבלה</strong>
                    <span>חד־פעמית או רוטינית שחוסמת את המשימה</span>
                  </li>
                  <li>
                    <strong>תפקיד</strong>
                    <span>אין את התפקיד הנדרש, או יכולת למלא אותו</span>
                  </li>
                  <li>
                    <strong>פק״ל</strong>
                    <span>חסר הפק״ל הנדרש למשבצת</span>
                  </li>
                  <li>
                    <strong>הגבלת סוגי משימה</strong>
                    <span>מוגבל לסוגים מסוימים — והמשימה הזו לא ביניהם</span>
                  </li>
                  <li>
                    <strong>חפיפה</strong>
                    <span>כבר משובץ במשימה חופפת באותו חלון</span>
                  </li>
                  <li>
                    <strong>מנוחה מינימלית</strong>
                    <span>לא נשאר מספיק זמן מנוחה לפני המשימה (לפי ההגדרה)</span>
                  </li>
                </ul>
                <p className="how-it-works-note">
                  אם אין מועמד שעומד בכל החוקים — המשבצת נשארת חסרה, עם הסבר מה
                  היה חסר.
                </p>
              </section>

              <section className="how-it-works-section">
                <h3>העדפות רכות — בין מי שמותר</h3>
                <p className="how-it-works-section-lead">
                  כשיש כמה מועמדים כשרים, המערכת מדרגת לפי הסדר הזה:
                </p>
                <ol className="how-it-works-pref-list">
                  <li>
                    <div className="how-it-works-pref-head">
                      <span className="how-it-works-pref-num">1</span>
                      <strong>מי שקיבל יותר אפטרים לאחרונה</strong>
                    </div>
                    <ul>
                      <li>אפטר = מנוחה / צופר לחייל</li>
                      <li>מי שכבר נח יתועדף למשימה</li>
                      <li>כדי לא להעמיס על מי שעדיין לא קיבל אפטר</li>
                    </ul>
                  </li>
                  <li>
                    <div className="how-it-works-pref-head">
                      <span className="how-it-works-pref-num">2</span>
                      <strong>מי עם מדד עומס היסטורי נמוך יותר</strong>
                    </div>
                    <ul>
                      <li>עומס = קושי המשימה × שעות שירות</li>
                      <li>נספרים רק שיבוצים שכבר פורסמו</li>
                      <li>«שבץ אותי» לבד לא מעלה את העומס</li>
                    </ul>
                  </li>
                  <li>
                    <div className="how-it-works-pref-head">
                      <span className="how-it-works-pref-num">3</span>
                      <strong>ניצול מינימום נדרש של מפקדים</strong>
                    </div>
                    <ul>
                      <li>אם חייל יכול למלא את המשבצת — הוא יועדף</li>
                      <li>מפקד/קצין יוצב כשהמשבצת דורשת אותו במפורש</li>
                      <li>או כשאין חייל מתאים זמין</li>
                    </ul>
                  </li>
                  <li>
                    <div className="how-it-works-pref-head">
                      <span className="how-it-works-pref-num">4</span>
                      <strong>פיזור בתוך אותו חלון</strong>
                    </div>
                    <ul>
                      <li>מי שכבר שובץ במשימות אחרות בחלון — עדיפות נמוכה יותר</li>
                      <li>מטרה: לא לרכז יותר מדי משימות על אותו אדם ביום אחד</li>
                    </ul>
                  </li>
                </ol>
              </section>

              <section className="how-it-works-section">
                <h3>איך זה קורה בפועל</h3>
                <ol className="how-it-works-steps">
                  <li>
                    <strong>בונים את חלון השיבוץ</strong>
                    <span>משימות רוטינה + מה שבחרתם (היום / מחר)</span>
                  </li>
                  <li>
                    <strong>מפרקים כל משימה למשבצות</strong>
                    <span>למשל: מפקד · חובש · חייל</span>
                  </li>
                  <li>
                    <strong>עובדים לפי סדר</strong>
                    <span>מוקדם בזמן קודם, ובתוך כך הקשות יותר קודם</span>
                  </li>
                  <li>
                    <strong>לכל משבצת</strong>
                    <span>מסננים אסורים → מדרגים מותרים → בוחרים הטוב ביותר</span>
                  </li>
                  <li>
                    <strong>מציגים טיוטה</strong>
                    <span>אפשר להחליף ידנית, לבדוק קונפליקטים, ואז לפרסם</span>
                  </li>
                </ol>
              </section>

              <section className="how-it-works-section">
                <h3>מה זה אומר בפועל</h3>
                <dl className="how-it-works-glossary">
                  <div>
                    <dt>שיבוץ «חסר איוש»</dt>
                    <dd>
                      <ul>
                        <li>לא נמצא מועמד שעומד בחוקים הקשיחים</li>
                        <li>המשבצת נשארת ריקה עד שתטפלו בחסם</li>
                      </ul>
                    </dd>
                  </div>
                  <div>
                    <dt>מפקד במשבצת חייל</dt>
                    <dd>
                      <ul>
                        <li>בדרך כלל רק אם לא נשאר חייל מתאים</li>
                        <li>לא בזבוז — זה מילוי כשאין ברירה טובה יותר</li>
                      </ul>
                    </dd>
                  </div>
                  <div>
                    <dt>מישהו עם עומס גבוה עדיין משובץ</dt>
                    <dd>
                      <ul>
                        <li>האחרים היו חסומים (חופשה / פק״ל / חפיפה)</li>
                        <li>החוקים הקשיחים תמיד גוברים על הוגנות</li>
                      </ul>
                    </dd>
                  </div>
                  <div>
                    <dt>אחרי «שבץ אותי» העומס לא עלה</dt>
                    <dd>
                      <ul>
                        <li>נכון — זו רק טיוטה</li>
                        <li>העומס מתעדכן רק ב«מאושר לפרסום»</li>
                      </ul>
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="how-it-works-section how-it-works-gold">
                <h3>עקרון הזהב</h3>
                <p>
                  <strong>
                    המערכת ממלאת קודם את מה שחייבים, ורק אחר כך מנסה להיות
                    הוגנת.
                  </strong>
                </p>
                <p>
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
