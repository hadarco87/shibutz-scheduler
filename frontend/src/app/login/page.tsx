"use client";

import { Suspense } from "react";
import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="login-wrap">
          <div className="panel">טוען...</div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
