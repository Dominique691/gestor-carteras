import { Check, X } from "lucide-react";
import { useMemo } from "react";
import zxcvbn from "zxcvbn";
import { PASSWORD_REQUIREMENTS } from "@/lib/password";
import { cn } from "@/lib/utils";

const LEVELS = [
  { label: "Muy débil", color: "bg-red-500", text: "text-red-600" },
  { label: "Débil", color: "bg-red-500", text: "text-red-600" },
  { label: "Aceptable", color: "bg-amber-500", text: "text-amber-600" },
  { label: "Fuerte", color: "bg-green-400", text: "text-green-600" },
  { label: "Muy fuerte", color: "bg-green-700", text: "text-green-700" },
] as const;

// Traducciones de las sugerencias más habituales de zxcvbn.
const SUGGESTIONS: Record<string, string> = {
  "Use a few words, avoid common phrases": "Usa varias palabras y evita frases comunes",
  "No need for symbols, digits, or uppercase letters": "No hacen falta símbolos, números ni mayúsculas",
  "Add another word or two. Uncommon words are better.": "Añade una o dos palabras poco comunes",
  "Capitalization doesn't help very much": "Poner mayúsculas ayuda poco",
  "All-uppercase is almost as easy to guess as all-lowercase": "Todo en mayúsculas es casi tan fácil de adivinar como todo en minúsculas",
  "Reversed words aren't much harder to guess": "Escribir palabras al revés no las hace mucho más difíciles",
  "Predictable substitutions like '@' instead of 'a' don't help very much": "Sustituciones previsibles como '@' por 'a' ayudan poco",
  "Avoid repeated words and characters": "Evita repetir palabras y caracteres",
  "Avoid sequences": "Evita secuencias",
  "Avoid recent years": "Evita años recientes",
  "Avoid years that are associated with you": "Evita años asociados a ti",
  "Avoid dates and years that are associated with you": "Evita fechas y años asociados a ti",
};

export function getPasswordScore(password: string): 0 | 1 | 2 | 3 | 4 {
  return password ? zxcvbn(password.slice(0, 72)).score : 0;
}

export function PasswordStrengthMeter({ password }: { password: string }) {
  const result = useMemo(() => (password ? zxcvbn(password.slice(0, 72)) : null), [password]);
  const score = result?.score ?? 0;
  const level = LEVELS[score];

  const hints = result
    ? [result.feedback.warning, ...result.feedback.suggestions]
        .filter(Boolean)
        .map((s) => SUGGESTIONS[s] ?? s)
        .slice(0, 2)
    : [];

  return (
    <div className="space-y-2" data-testid="password-strength">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            data-testid="strength-segment"
            className={cn("h-1.5 flex-1 rounded-full", password && i < Math.max(score, 1) ? level.color : "bg-muted")}
          />
        ))}
      </div>
      <p className="text-xs" aria-live="polite">
        {password ? (
          <>
            <span className={cn("font-medium", level.text)}>{level.label}</span>
            {hints.length > 0 && <span className="text-muted-foreground"> · {hints.join(". ")}</span>}
          </>
        ) : (
          <span className="text-muted-foreground">Escribe una contraseña</span>
        )}
      </p>
      <ul className="space-y-0.5 text-xs">
        {PASSWORD_REQUIREMENTS.map((r) => {
          const ok = r.test(password);
          return (
            <li
              key={r.id}
              data-met={ok}
              className={cn("flex items-center gap-1.5", ok ? "text-green-600" : "text-muted-foreground")}
            >
              {ok ? <Check className="size-3.5" aria-label="Cumplido" /> : <X className="size-3.5" aria-label="Pendiente" />}
              {r.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
