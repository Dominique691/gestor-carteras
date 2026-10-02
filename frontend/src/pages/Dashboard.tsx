import { ArrowDownRight, ArrowUpRight, Loader2, Minus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { AddTransactionDialog } from "@/components/AddTransactionDialog";
import { TransactionHistory } from "@/components/TransactionHistory";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import {
  formatEur,
  formatEurSigned,
  formatPercent,
  formatPercentSigned,
  formatPrice,
  formatShares,
} from "@/lib/format";
import type { Portfolio, TransactionItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const CATEGORY_COLORS = ["#2563eb", "#f59e0b", "#10b981", "#8b5cf6", "#ef4444"];

function PnlText({ value, children, className }: { value: number; children: ReactNode; className?: string }) {
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium",
        value > 0 && "text-emerald-600 dark:text-emerald-400",
        value < 0 && "text-red-600 dark:text-red-400",
        value === 0 && "text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-4" aria-hidden />
      {children}
    </span>
  );
}

function Kpi({ title, children, sub }: { title: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <Card>
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

  // Cartera e historial se cargan en paralelo y fallan por separado: un error en uno no oculta el otro.
  const load = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
        </div>
        <AddTransactionDialog onCreated={load} />
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
            <Kpi title="Patrimonio total">{formatEur(portfolio.totalValue)}</Kpi>
            <Kpi title="Inversión total">{formatEur(portfolio.totalInvested)}</Kpi>
            <Kpi title="Ganancia / Pérdida">
              <PnlText value={portfolio.pnl} className="text-2xl">
                {formatEurSigned(portfolio.pnl)}
              </PnlText>
            </Kpi>
            <Kpi title="Rentabilidad">
              <PnlText value={portfolio.pnlPercentage} className="text-2xl">
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
                  <div className="h-64" role="img" aria-label="Gráfico circular de distribución por categoría">
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
                            <Cell key={c.name} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => formatEur(Number(v))} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="space-y-3" aria-label="Leyenda de categorías">
                    {byCategory.map((c, i) => (
                      <li key={c.name} className="flex items-center gap-3 text-sm">
                        <span
                          className="size-3 rounded-full"
                          style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
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
                        <TableRow key={p.fundId}>
                          <TableCell className="min-w-56 whitespace-normal font-medium">
                            {p.name}
                            <div className="text-xs font-normal text-muted-foreground">{p.category}</div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{p.isin}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatShares(p.shares)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatPrice(p.currentNAV)}</TableCell>
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
