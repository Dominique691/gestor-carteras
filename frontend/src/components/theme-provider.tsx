import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";

const DARK_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readTheme(storageKey: string, fallback: Theme): Theme {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : fallback;
  } catch {
    return fallback;
  }
}

const systemPrefersDark = () => window.matchMedia?.(DARK_QUERY).matches ?? false;

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "ui-theme",
}: {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}) {
  const [theme, setThemeState] = useState<Theme>(() => readTheme(storageKey, defaultTheme));
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Sigue los cambios del sistema operativo mientras el tema sea "system".
  useEffect(() => {
    const media = window.matchMedia?.(DARK_QUERY);
    if (!media) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = useCallback(
    (next: Theme) => {
      // Desactiva las transiciones un instante para evitar parpadeos al repintar todo el árbol.
      const style = document.createElement("style");
      style.appendChild(document.createTextNode("*,*::before,*::after{transition:none!important}"));
      document.head.appendChild(style);
      void window.getComputedStyle(document.body).opacity;
      setTimeout(() => style.remove(), 50);

      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // Sin localStorage la preferencia solo dura mientras la pestaña esté abierta.
      }
      setThemeState(next);
    },
    [storageKey],
  );

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme debe usarse dentro de <ThemeProvider>");
  return ctx;
}
