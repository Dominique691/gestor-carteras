import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler, TOKEN_KEY, type AuthResponse, type AuthUser, type MessageResponse } from "@/lib/api";

const USER_KEY = "gestor.user";

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Crea la cuenta sin iniciar sesión (queda pendiente de verificar el email); devuelve el mensaje del backend. */
  register: (email: string, password: string) => Promise<string>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readUser(): AuthUser | null {
  try {
    const raw = readStorage(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function writeSession(session: AuthResponse | null) {
  try {
    if (session) {
      localStorage.setItem(TOKEN_KEY, session.token);
      localStorage.setItem(USER_KEY, JSON.stringify(session.user));
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  } catch {
    // Sin acceso a localStorage la sesión dura solo mientras la pestaña esté abierta.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => readStorage(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(readUser);

  const setSession = useCallback((session: AuthResponse | null) => {
    writeSession(session);
    setToken(session?.token ?? null);
    setUser(session?.user ?? null);
  }, []);

  const logout = useCallback(() => setSession(null), [setSession]);

  const login = useCallback(
    async (email: string, password: string) =>
      setSession(await api<AuthResponse>("/api/auth/login", { body: { email, password } })),
    [setSession],
  );

  const register = useCallback(
    async (email: string, password: string) =>
      (await api<MessageResponse>("/api/auth/register", { body: { email, password } })).message,
    [],
  );

  // Si el backend responde 401 con un token guardado (caducado o inválido), se cierra la sesión.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Mantiene sincronizadas varias pestañas: login/logout en una se refleja en las demás.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== TOKEN_KEY && e.key !== null) return;
      setToken(readStorage(TOKEN_KEY));
      setUser(readUser());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ token, user, isAuthenticated: token !== null, login, register, logout }),
    [token, user, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
