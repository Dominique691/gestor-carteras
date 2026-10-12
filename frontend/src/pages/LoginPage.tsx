import { Loader2, MailCheck, TrendingUp } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordStrengthMeter, getPasswordScore } from "@/components/PasswordStrengthMeter";
import { ResendVerification } from "@/components/ResendVerification";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import { MIN_PASSWORD_SCORE, meetsRequirements } from "@/lib/password";

type Mode = "login" | "register";

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Tras registrarse: mensaje de "revisa tu correo". Tras un login denegado por no verificar: email para reenviar.
  const [registeredMessage, setRegisteredMessage] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  const isLogin = mode === "login";
  const passwordOk = isLogin || (meetsRequirements(password) && getPasswordScore(password) >= MIN_PASSWORD_SCORE);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setUnverifiedEmail(null);
    setLoading(true);
    try {
      if (isLogin) {
        await login(email, password);
        navigate((location.state as { from?: string } | null)?.from ?? "/dashboard", { replace: true });
      } else {
        setRegisteredMessage(await register(email, password));
        setPassword("");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (isLogin && err.status === 403) setUnverifiedEmail(email);
        setError(err.details?.map((d) => d.message).join(". ") || err.message);
      } else {
        setError("No se pudo conectar con el servidor");
      }
    } finally {
      setLoading(false);
    }
  }

  function switchMode() {
    setMode(isLogin ? "register" : "login");
    setError(null);
    setUnverifiedEmail(null);
  }

  function backToLogin() {
    setRegisteredMessage(null);
    setMode("login");
  }

  if (registeredMessage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <MailCheck className="mx-auto size-10 text-primary" aria-hidden />
            <h1 className="text-xl font-semibold">Revisa tu correo</h1>
            <CardTitle className="sr-only">Cuenta creada</CardTitle>
            <CardDescription role="status">{registeredMessage}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-sm text-muted-foreground">
              Abre el enlace del email para activar tu cuenta y después inicia sesión. Si no lo encuentras, mira en la
              carpeta de spam.
            </p>
            <Button className="w-full" onClick={backToLogin}>
              Ir a iniciar sesión
            </Button>
            <ResendVerification email={email} />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <TrendingUp className="mx-auto size-8 text-primary" />
          <h1 className="text-xl font-semibold">Gestor de Carteras</h1>
          <CardTitle className="sr-only">{isLogin ? "Iniciar sesión" : "Crear cuenta"}</CardTitle>
          <CardDescription>
            {isLogin ? "Inicia sesión para ver tu cartera" : "Crea una cuenta para empezar"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                Contraseña
              </label>
              <Input
                id="password"
                type="password"
                autoComplete={isLogin ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {!isLogin && <PasswordStrengthMeter password={password} />}
              {isLogin && (
                <Link to="/forgot-password" className="block text-right text-xs text-primary hover:underline">
                  ¿Olvidaste tu contraseña?
                </Link>
              )}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading || !passwordOk}>
              {loading && <Loader2 className="animate-spin" />}
              {isLogin ? "Entrar" : "Registrarme"}
            </Button>
          </form>
          {unverifiedEmail && (
            <div className="mt-3">
              <ResendVerification key={unverifiedEmail} email={unverifiedEmail} />
            </div>
          )}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {isLogin ? "¿No tienes cuenta?" : "¿Ya tienes cuenta?"}{" "}
            <button type="button" onClick={switchMode} className="font-medium text-primary hover:underline">
              {isLogin ? "Regístrate" : "Inicia sesión"}
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
