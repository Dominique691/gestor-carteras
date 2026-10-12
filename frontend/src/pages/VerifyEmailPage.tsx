import { CircleAlert, CircleCheck, Loader2, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ResendVerification } from "@/components/ResendVerification";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError, type MessageResponse } from "@/lib/api";

type Status = "loading" | "success" | "expired" | "invalid";

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<Status>(token ? "loading" : "invalid");
  const [message, setMessage] = useState<string | null>(null);
  // El token es de un solo uso: en StrictMode el efecto se ejecuta dos veces y la segunda petición fallaría.
  const requested = useRef(false);

  useEffect(() => {
    if (!token || requested.current) return;
    requested.current = true;
    api<MessageResponse>("/api/auth/verify-email", { body: { token } })
      .then(() => setStatus("success"))
      .catch((err) => {
        setStatus(err instanceof ApiError && err.status === 410 ? "expired" : "invalid");
        setMessage(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
      });
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <TrendingUp className="mx-auto size-8 text-primary" />
          <h1 className="text-xl font-semibold">Gestor de Carteras</h1>
          <CardTitle className="sr-only">Verificación del email</CardTitle>
          <CardDescription>Activación de tu cuenta</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === "loading" && (
            <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Verificando tu email…
            </p>
          )}

          {status === "success" && (
            <>
              <div role="status" className="space-y-2 text-center">
                <CircleCheck className="mx-auto size-10 text-emerald-600 dark:text-emerald-400" aria-hidden />
                <p className="font-medium">¡Email verificado!</p>
                <p className="text-sm text-muted-foreground">Tu cuenta está activa. Ya puedes iniciar sesión.</p>
              </div>
              <Button asChild className="w-full">
                <Link to="/login">Iniciar sesión</Link>
              </Button>
            </>
          )}

          {(status === "expired" || status === "invalid") && (
            <>
              <div role="alert" className="space-y-2 text-center">
                <CircleAlert className="mx-auto size-10 text-destructive" aria-hidden />
                <p className="font-medium">
                  {status === "expired" ? "El enlace ha caducado" : "El enlace no es válido"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {status === "expired"
                    ? "Los enlaces de activación caducan a las 24 horas. Pide uno nuevo con tu email."
                    : (message ?? "Falta el código de activación.") +
                      " Si ya activaste tu cuenta, inicia sesión; si no, pide un enlace nuevo."}
                </p>
              </div>
              <ResendVerification />
            </>
          )}

          {status !== "success" && (
            <p className="text-center text-sm">
              <Link to="/login" className="font-medium text-primary hover:underline">
                Volver a iniciar sesión
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
