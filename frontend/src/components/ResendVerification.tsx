import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError, type MessageResponse } from "@/lib/api";

/**
 * Pide un nuevo enlace de activación. Si se conoce el email (p. ej. tras un login denegado) basta un botón;
 * si no, se pide antes de enviar.
 */
export function ResendVerification({ email: knownEmail }: { email?: string }) {
  const [email, setEmail] = useState(knownEmail ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<MessageResponse>("/api/auth/resend-verification", { body: { email } });
      setMessage(res.message);
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

  if (message) {
    return (
      <p role="status" className="text-sm">
        {message}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      {!knownEmail && (
        <div className="space-y-1.5">
          <label htmlFor="resend-email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="resend-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" variant="outline" className="w-full" disabled={loading || !email}>
        {loading && <Loader2 className="animate-spin" />}
        Reenviar enlace de activación
      </Button>
    </form>
  );
}
