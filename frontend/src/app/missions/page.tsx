"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MissionsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings");
  }, [router]);
  return (
    <div className="login-wrap">
      <div className="panel">מעביר להגדרות...</div>
    </div>
  );
}
