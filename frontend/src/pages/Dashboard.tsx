import { ArrowDownRight, ArrowUpRight, Coins, Loader2, Minus, PiggyBank, RefreshCw, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { toast } from "sonner";
import { AddTransactionDialog } from "@/components/AddTransactionDialog";
import { PortfolioHistoryChart, PortfolioHistorySkeleton } from "@/components/PortfolioHistoryChart";
import { TransactionHistory } from "@/components/TransactionHistory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import {
  formatDateTime,
  formatDateTimeShort,
  formatEur,
  formatEurSigned,
  formatPercent,
  formatPercentSigned,
  formatPrice,
  formatShares,
} from "@/lib/format";
import type { Portfolio, PortfolioHistoryPoint, SyncSummary, TransactionItem } from "@/lib/types";
import { cn } from "@/lib/utils";

// Paleta fintech: índigo para renta variable y teal para renta fija; el resto, colores de reserva.
const FALLBACK_COLORS = ["#f59e0b", "#8b5cf6", "#ef4444", "#0ea5e9"];
function categoryColor(name: string, index: number) {
  if (/variable/i.test(name)) return "#6366f1";
  if (/fija/i.test(name)) return "#14b8a6";
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function PnlText({
  value,
  children,
  className,
  pill,
}: {
  value: number;
  children: ReactNode;
  className?: string;
  pill?: boolean;
}) {
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium",
        value > 0 && "text-emerald-700 dark:text-emerald-400",
        value < 0 && "text-red-700 dark:text-red-400",
        value === 0 && "text-muted-foreground",
        pill && "rounded-full px-2.5 py-0.5",
        pill && value > 0 && "bg-emerald-50 dark:bg-emerald-950/50",
        pill && value < 0 && "bg-red-50 dark:bg-red-950/50",
        pill && value === 0 && "bg-muted",
        className,
      )}
    >
      <Icon className="size-4" aria-hidden />
      {children}
    </span>
  );
}

function Kpi({ title, icon: Icon, children, sub }: { title: string; icon: LucideIcon; children: ReactNode; sub?: ReactNode }) {
  return (
    <Card className="relative">
      <span className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
        <Icon className="size-4" />
      </span>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{children}</CardTitle>
      </CardHeader>
      {sub && <CardContent className="text-sm">{sub}</CardContent>}
    </Card>
  );
}

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [evolution, setEvolution] = useState<PortfolioHistoryPoint[] | null>(null);
  const [evolutionError, setEvolutionError] = useState<string | null>(null);

  // Cartera, historial y evolución se cargan en paralelo y fallan por separado: un error en uno no oculta el resto.
  // La evolución no bloquea el resto del dashboard: su tarjeta muestra un esqueleto hasta que llega.
  const load = useCallback(async () => {
    const evolutionLoad = api<PortfolioHistoryPoint[]>("/api/portfolio/history").then(
      (points) => {
        setEvolution(points);
        setEvolutionError(null);
      },
      () => setEvolutionError("No se pudo cargar la evolución del patrimonio"),
    );
    const [p, t] = await Promise.allSettled([
      api<Portfolio>("/api/portfolio"),
      api<TransactionItem[]>("/api/transactions"),
    ]);
    if (p.status === "fulfilled") {
      setPortfolio(p.value);
      setError(null);
    } else {
      setError("No se pudo cargar la cartera");
    }
    if (t.status === "fulfilled") {
      setTransactions(t.value);
      setHistoryError(null);
    } else {
      setHistoryError("No se pudo cargar el historial de transacciones");
    }
    await evolutionLoad;
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const [syncing, setSyncing] = useState(false);

  // Fuerza la descarga de precios de mercado y avisa del resultado con una notificación.
  async function syncPrices() {
    setSyncing(true);
    try {
      const s = await api<SyncSummary>("/api/funds/sync-prices", { method: "POST" });
      if (s.updated > 0 && s.failed === 0) {
        toast.success(`Precios actualizados: ${s.updated} ${s.updated === 1 ? "fondo" : "fondos"}`);
      } else if (s.updated > 0) {
        toast.warning(
          `${s.updated} ${s.updated === 1 ? "fondo actualizado" : "fondos actualizados"}; ${s.failed} sin respuesta del proveedor (se mantiene su último precio)`,
        );
      } else if (s.failed > 0) {
        toast.error("No se pudieron obtener los precios de mercado. Se mantienen los últimos guardados.");
      } else {
        toast.info("No hay fondos con cotización en bolsa que actualizar.");
      }
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setSyncing(false);
    }
  }

  // Momento de la actualización de precios más reciente entre los fondos en cartera.
  const lastPriceUpdate = useMemo(() => {
    const times = (portfolio?.positions ?? []).flatMap((p) => (p.lastPriceUpdate ? [p.lastPriceUpdate] : []));
    return times.length > 0 ? times.reduce((a, b) => (a > b ? a : b)) : null;
  }, [portfolio]);

  const byCategory = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of portfolio?.positions ?? []) {
      totals.set(p.category, (totals.get(p.category) ?? 0) + p.currentValue);
    }
    const total = [...totals.values()].reduce((a, b) => a + b, 0);
    return [...totals.entries()]
      .map(([name, value]) => ({ name, value, percentage: total ? (value / total) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);
  }, [portfolio]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Resumen de tu cartera</p>
          {portfolio && portfolio.positions.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {lastPriceUpdate ? (
                <>
                  Precios de mercado actualizados el{" "}
                  <time dateTime={lastPriceUpdate}>{formatDateTimeShort(lastPriceUpdate)}</time>
                </>
              ) : (
                "Precios de mercado sin actualizar"
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={syncPrices} disabled={syncing}>
            <RefreshCw className={cn(syncing && "animate-spin")} />
            Actualizar precios de mercado
          </Button>
          <AddTransactionDialog onCreated={load} />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {!portfolio && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" /> Cargando cartera…
        </div>
      )}

      {portfolio && (
        <>
          <section aria-label="Indicadores" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi title="Patrimonio total" icon={Wallet}>{formatEur(portfolio.totalValue)}</Kpi>
            <Kpi title="Inversión total" icon={PiggyBank}>{formatEur(portfolio.totalInvested)}</Kpi>
            <Kpi title="Ganancia / Pérdida" icon={Coins}>
              <PnlText value={portfolio.pnl} pill className="text-xl">
                {formatEurSigned(portfolio.pnl)}
              </PnlText>
            </Kpi>
            <Kpi title="Rentabilidad" icon={TrendingUp}>
              <PnlText value={portfolio.pnlPercentage} pill className="text-xl">
                {formatPercentSigned(portfolio.pnlPercentage)}
              </PnlText>
            </Kpi>
          </section>

          {portfolio.positions.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Tu cartera está vacía</CardTitle>
                <CardDescription>
                  Pulsa «Añadir transacción» para registrar tu primera compra y ver aquí tu distribución.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Distribución por categoría</CardTitle>
                  <CardDescription>Peso de cada categoría sobre el valor de la cartera</CardDescription>
                </CardHeader>
                <CardContent className="grid items-center gap-6 md:grid-cols-2">
                  <div className="relative h-64" role="img" aria-label="Gráfico circular de distribución por categoría">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={byCategory}
                          dataKey="value"
                          nameKey="name"
                          innerRadius="55%"
                          outerRadius="85%"
                          paddingAngle={2}
                        >
                          {byCategory.map((c, i) => (
                            <Cell key={c.name} fill={categoryColor(c.name, i)} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => formatEur(Number(v))} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center" data-testid="donut-center">
                      <span className="text-xs text-muted-foreground">Patrimonio</span>
                      <span className="text-lg font-semibold tabular-nums">{formatEur(portfolio.totalValue)}</span>
                    </div>
                  </div>
                  <ul className="space-y-3" aria-label="Leyenda de categorías">
                    {byCategory.map((c, i) => (
                      <li key={c.name} className="flex items-center gap-3 text-sm">
                        <span
                          className="size-3 rounded-full"
                          style={{ backgroundColor: categoryColor(c.name, i) }}
                          aria-hidden
                        />
                        <span className="flex-1 font-medium">{c.name}</span>
                        <span className="text-muted-foreground tabular-nums">{formatEur(c.value)}</span>
                        <Badge variant="secondary" className="tabular-nums">
                          {formatPercent(c.percentage)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {evolutionError ? (
                <p role="alert" className="text-sm text-destructive">
                  {evolutionError}
                </p>
              ) : evolution ? (
                <PortfolioHistoryChart data={evolution} />
              ) : (
                <PortfolioHistorySkeleton />
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Fondos en cartera</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nombre</TableHead>
                        <TableHead>ISIN</TableHead>
                        <TableHead className="text-right">Participaciones</TableHead>
                        <TableHead className="text-right">Precio actual</TableHead>
                        <TableHead className="text-right">Valor total</TableHead>
                        <TableHead className="text-right">P&amp;L</TableHead>
                        <TableHead className="text-right">% actual</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {portfolio.positions.map((p) => (
                        <TableRow key={p.fundId} className="odd:bg-slate-50/50 dark:odd:bg-slate-900/50">
                          <TableCell className="min-w-56 whitespace-normal font-medium">
                            {p.name}
                            <div className="text-xs font-normal text-muted-foreground">{p.category}</div>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{p.isin}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatShares(p.shares)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatPrice(p.currentNAV)}
                            <div className="whitespace-nowrap text-xs text-muted-foreground">
                              {p.lastPriceUpdate ? (
                                <time dateTime={p.lastPriceUpdate} title={formatDateTime(p.lastPriceUpdate)}>
                                  {formatDateTimeShort(p.lastPriceUpdate)}
                                </time>
                              ) : (
                                "Sin actualizar"
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatEur(p.currentValue)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <PnlText value={p.pnl} className="justify-end">
                              {formatEurSigned(p.pnl)}
                            </PnlText>
                            <div className="text-xs text-muted-foreground">{formatPercentSigned(p.pnlPercentage)}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatPercent(p.portfolioPercentage)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {historyError && (
        <p role="alert" className="text-sm text-destructive">
          {historyError}
        </p>
      )}
      {transactions.length > 0 && <TransactionHistory transactions={transactions} />}
    </div>
  );
}
