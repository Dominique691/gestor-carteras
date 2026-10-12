/** Cliente HTTP mínimo para la API del backend (el proxy de Vite redirige /api a :3001). */

/** URL base del backend. Vacía en desarrollo (el proxy de Vite redirige /api); en producción, VITE_API_URL. */
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export const TOKEN_KEY = "gestor.token";

export interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface MessageResponse {
  message: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;

/** El AuthProvider registra aquí cómo cerrar la sesión cuando el backend responde 401. */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getStoredToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Un 401 con token guardado = sesión caducada; sin token es un login fallido y lo gestiona el formulario.
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(res.status, data?.error ?? `Error ${res.status}`, data?.details);
  }
  return data as T;
}
