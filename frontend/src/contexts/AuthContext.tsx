"use client";
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  getToken,
  setToken,
  clearToken,
  getAuthUser,
  setAuthUser,
  login as apiLogin,
  type LoginRequest,
  type AuthUser,
} from "@/lib/auth";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (req: LoginRequest) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = getToken();
    const storedUser = getAuthUser();
    if (stored && storedUser) {
      setTokenState(stored);
      setUser(storedUser);
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (req: LoginRequest) => {
    const res = await apiLogin(req);
    setToken(res.token);
    setAuthUser({ username: req.username });
    setTokenState(res.token);
    setUser({ username: req.username });
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
