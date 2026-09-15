"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, User } from "@/lib/api";

type RegisterInput = {
  email: string;
  password: string;
  full_name: string;
  company_name: string;
};

type RegisterInviteInput = {
  token: string;
  email: string;
  password: string;
  full_name: string;
};

type AuthState = {
  token: string | null;
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  registerInvite: (input: RegisterInviteInput) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("shibutz_token");
    if (!saved) {
      setLoading(false);
      return;
    }
    api
      .me(saved)
      .then((u) => {
        setToken(saved);
        setUser(u);
      })
      .catch(() => localStorage.removeItem("shibutz_token"))
      .finally(() => setLoading(false));
  }, []);

  const applyToken = useCallback(async (accessToken: string) => {
    localStorage.setItem("shibutz_token", accessToken);
    const u = await api.me(accessToken);
    setToken(accessToken);
    setUser(u);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email, password);
      await applyToken(res.access_token);
    },
    [applyToken]
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const res = await api.register(input);
      await applyToken(res.access_token);
    },
    [applyToken]
  );

  const registerInvite = useCallback(
    async (input: RegisterInviteInput) => {
      const res = await api.registerInvite(input);
      await applyToken(res.access_token);
    },
    [applyToken]
  );

  const logout = useCallback(() => {
    localStorage.removeItem("shibutz_token");
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ token, user, loading, login, register, registerInvite, logout }),
    [token, user, loading, login, register, registerInvite, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
