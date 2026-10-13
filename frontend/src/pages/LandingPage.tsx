import { CalendarClock, Check, LineChart, Loader2, Scale, ShieldCheck, TrendingUp, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthCard } from "@/components/AuthCard";
import { ModeToggle } from "@/components/ModeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const features: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Scale,
    title: "Rebalanceo inteligente",
    description: "Te decimos en qué fondos invertir tu próxima aportación para acercarte a tu reparto objetivo, sin vender nada.",
  },
  {
    icon: CalendarClock,
    title: "Aportaciones programadas",
    description: "Automatiza tu aportación periódica y deja que el plan se ejecute solo, mes a mes.",
  },
  {
    icon: LineChart,
    title: "Gráficos históricos",
    description: "Sigue la evolución de tu patrimonio y de tu rentabilidad a lo largo del tiempo.",
  },
  {
    icon: ShieldCheck,
    title: "Seguridad",
    description: "Verificación de email, contraseñas robustas y sesiones protegidas. Nunca pedimos acceso a tu broker.",
  },
];

const plans = [
  {
    name: "Free",
    price: "0 €",
    period: "para siempre",
    description: "Todo lo esencial para llevar tu cartera indexada.",
    features: ["Seguimiento de tu cartera", "Reparto objetivo y rebalanceo", "Histórico de operaciones", "Modo claro y oscuro"],
    cta: "Empezar gratis",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "4,99 €",
    period: "al mes",
    description: "Para quien quiere automatizar y analizar a fondo.",
    features: [
      "Todo lo del plan Free",
      "Aportaciones periódicas automáticas",
      "Gráficos históricos avanzados",
      "Soporte prioritario",
    ],
    cta: "Elegir Pro",
    highlighted: true,
  },
];

export default function LandingPage() {
  const { startDemo } = useAuth();
  const navigate = useNavigate();
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  async function openDemo() {
    setDemoError(null);
    setDemoLoading(true);
    try {
      await startDemo();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setDemoError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
      setDemoLoading(false);
    }
  }

  const goToAccess = () => document.getElementById("acceso")?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold">
            <TrendingUp className="size-5 text-primary" aria-hidden />
            <span>Gestor de Carteras</span>
          </Link>
          <nav aria-label="Principal" className="ml-4 hidden items-center gap-1 md:flex">
            <a href="#beneficios" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Beneficios
            </a>
            <a href="#precios" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Precios
            </a>
            <Link to="/forgot-password" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Recuperar contraseña
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={openDemo} disabled={demoLoading}>
              {demoLoading && <Loader2 className="animate-spin" />}
              Probar demo
            </Button>
            <ModeToggle />
          </div>
        </div>
        {demoError && (
          <p role="alert" className="border-t bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
            {demoError}
          </p>
        )}
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 lg:grid-cols-[1.2fr_1fr] lg:py-20">
          <div className="space-y-6">
            <Badge variant="secondary">Para inversores indexados</Badge>
            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
              Tu cartera indexada, siempre en equilibrio
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              Define tu reparto objetivo, registra tus aportaciones y descubre en cada momento dónde invertir para
              mantener el rumbo. Sin hojas de cálculo, sin vender, sin complicaciones.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" className="h-10 px-4 text-base" onClick={goToAccess}>
                Crear cuenta gratis
              </Button>
              <Button asChild size="lg" variant="outline" className="h-10 px-4 text-base">
                <a href="#beneficios">Ver cómo funciona</a>
              </Button>
            </div>
          </div>
          <div id="acceso" className="mx-auto w-full max-w-sm scroll-mt-20">
            <AuthCard className="shadow-lg" />
          </div>
        </section>

        <section id="beneficios" className="scroll-mt-14 border-t bg-muted/30 py-16">
          <div className="mx-auto max-w-6xl px-4">
            <h2 className="text-center text-3xl font-bold tracking-tight">Todo lo que necesitas para invertir con método</h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
              Herramientas pensadas para el inversor a largo plazo que aporta con regularidad.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ icon: Icon, title, description }) => (
                <Card key={title}>
                  <CardHeader>
                    <span className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <CardTitle className="text-base">{title}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-muted-foreground">{description}</CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section id="precios" className="scroll-mt-14 border-t py-16">
          <div className="mx-auto max-w-4xl px-4">
            <h2 className="text-center text-3xl font-bold tracking-tight">Planes y precios</h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
              Empieza gratis y pasa a Pro cuando quieras automatizar tu inversión.
            </p>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              {plans.map((plan) => (
                <Card key={plan.name} className={cn(plan.highlighted && "ring-2 ring-primary")}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      {plan.name}
                      {plan.highlighted && <Badge>Recomendado</Badge>}
                    </CardTitle>
                    <p className="pt-2">
                      <span className="text-3xl font-bold">{plan.price}</span>{" "}
                      <span className="text-muted-foreground">{plan.period}</span>
                    </p>
                    <CardDescription>{plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-2">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Button className="w-full" variant={plan.highlighted ? "default" : "outline"} onClick={goToAccess}>
                      {plan.cta}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Gestor de Carteras
      </footer>
    </div>
  );
}
