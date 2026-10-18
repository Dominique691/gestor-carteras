import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

/** Solo deja pasar a usuarios autenticados; si no, redirige a /login (o a la landing tras salir). */
export function ProtectedRoute() {
  const { isAuthenticated, signedOut } = useAuth();
  const location = useLocation();
  if (isAuthenticated) return <Outlet />;
  // Salida voluntaria: a la landing. Sesión caducada o acceso directo: a /login recordando el destino.
  if (signedOut) return <Navigate to="/" replace />;
  return <Navigate to="/login" replace state={{ from: location.pathname }} />;
}

/** Rutas solo para visitantes (login): si ya hay sesión, va al dashboard. */
export function GuestRoute() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <Outlet />;
}
