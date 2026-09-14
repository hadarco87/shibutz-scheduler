"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { PilotBanner } from "@/components/PilotBanner";

const links = [
  { href: "/", label: "שיבוץ" },
  { href: "/people", label: "כוח אדם" },
  { href: "/availability", label: "חופשות ומגבלות" },
  { href: "/settings", label: "הגדרות" },
  { href: "/workload", label: "מדד עומס" },
  { href: "/history", label: "היסטוריה" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout, token } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !token) router.replace("/login");
  }, [loading, token, router]);

  if (loading || !token || !user) {
    return (
      <div className="login-wrap">
        <div className="panel">טוען...</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="app-chrome">
        <header className="topbar">
          <div className="brand">
            <strong>שיבוץ</strong>
            <span>
              {user.company_name ? `${user.company_name} · ` : ""}
              {user.full_name}
            </span>
          </div>
          <nav className="nav">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={pathname === l.href ? "active" : undefined}
              >
                {l.label}
              </Link>
            ))}
            <button className="btn btn-ghost btn-small" onClick={logout} type="button">
              יציאה
            </button>
          </nav>
        </header>
        <PilotBanner />
      </div>
      <main className="main">{children}</main>
    </div>
  );
}
