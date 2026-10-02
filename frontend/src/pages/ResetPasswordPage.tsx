import { Loader2, TrendingUp } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PasswordStrengthMeter, getPasswordScore } from "@/components/PasswordStrengthMeter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { MIN_PASSWORD_SCORE, meetsRequirements } from "@/lib/password";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const passwordOk = meetsRequirements(password) && getPasswordScore(password) >= MIN_PASSWORD_SCORE;

  // Tras el éxito, vuelve al login; el temporizador se cancela si se abandona la página.
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => navigate("/login", { replace: true }), 2500);
    return () => clearTimeout(id);
  }, [done, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api("/api/auth/reset-password", { body: { token, newPassword: password } });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.details?.map((d) => d.message).join(". ") || err.message
          : "No se pudo conectar con el servidor",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <TrendingUp className="mx-auto size-8 text-primary" />
          <h1 className="text-xl font-semibold">Gestor de Carteras</h1>
          <CardTitle className="sr-only">Nueva contraseña</CardTitle>
          <CardDescription>Elige una nueva contraseña</CardDescription>
        </CardHeader>
        <CardContent>
          {!token ? (
            <p role="alert" className="text-sm text-destructive">
              El enlace no es válido. Solicita uno nuevo.
            </p>
          ) : done ? (
            <p role="status" className="text-sm">
              Contraseña actualizada. Redirigiendo al inicio de sesión…
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <label htmlFor="new-password" className="text-sm font-medium">
                  Nueva contraseña
                </label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <PasswordStrengthMeter password={password} />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={loading || !passwordOk}>
                {loading && <Loader2 className="animate-spin" />}
                Restablecer contraseña
              </Button>
            </form>
          )}
          <p className="mt-4 text-center text-sm">
            <Link to={token ? "/login" : "/forgot-password"} className="font-medium text-primary hover:underline">
              {token ? "Volver a iniciar sesión" : "Solicitar un enlace nuevo"}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
