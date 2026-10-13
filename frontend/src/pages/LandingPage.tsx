import { CalendarClock, LineChart, Loader2, Scale, ShieldCheck, TrendingUp, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthCard } from "@/components/AuthCard";
import { ModeToggle } from "@/components/ModeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

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

const screenshots = [
  {
    name: "rebalanceo",
    height: 618,
    title: "Rebalanceo inteligente",
    description: "Indica cuánto vas a aportar y verás en qué fondos invertirlo para acercarte a tu reparto objetivo.",
    alt: "Tabla de resultado del rebalanceo con el porcentaje actual y objetivo de cada fondo y la aportación sugerida",
  },
  {
    name: "evolucion",
    height: 573,
    title: "Evolución de tu patrimonio",
    description: "Compara el capital que has invertido con el valor de mercado de tu cartera a lo largo del tiempo.",
    alt: "Gráfico de líneas con el capital invertido y el valor actual de la cartera",
  },
  {
    name: "aportacion",
    height: 596,
    title: "Aportaciones programadas",
    description: "Activa «Repetir automáticamente» en tu aportación, elige la frecuencia y la primera fecha, y se repartirá sola entre tus fondos según tus objetivos.",
    alt: "Formulario de nueva aportación con el interruptor de repetir automáticamente activado y los desplegables de frecuencia y primera fecha",
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
            <a href="#capturas" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
              Capturas
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

        <section id="capturas" className="scroll-mt-14 border-t py-16">
          <div className="mx-auto max-w-4xl px-4">
            <h2 className="text-center text-3xl font-bold tracking-tight">Así se ve por dentro</h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
              Capturas reales de la aplicación con una cartera de ejemplo.
            </p>
            <div className="mt-10 space-y-12">
              {screenshots.map(({ name, height, title, description, alt }) => (
                <figure key={name} className="space-y-4">
                  <figcaption>
                    <h3 className="text-xl font-semibold">{title}</h3>
                    <p className="mt-1 text-muted-foreground">{description}</p>
                  </figcaption>
                  <div className="overflow-hidden rounded-xl shadow-lg ring-1 ring-foreground/10">
                    <img
                      src={`/screenshots/${name}-light.png`}
                      alt={alt}
                      width={1680}
                      height={height}
                      loading="lazy"
                      className="block h-auto w-full dark:hidden"
                    />
                    <img
                      src={`/screenshots/${name}-dark.png`}
                      alt={alt}
                      width={1680}
                      height={height}
                      loading="lazy"
                      className="hidden h-auto w-full dark:block"
                    />
                  </div>
                </figure>
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
