import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatEur, formatEurSigned } from "@/lib/format";
import type { PortfolioHistoryPoint } from "@/lib/types";
import { cn } from "@/lib/utils";

// Las fechas llegan como YYYY-MM-DD (UTC): se formatean en UTC para que no cambien de día según la zona horaria.
const dayLong = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const dayShort = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("es-ES", { month: "short", year: "2-digit", timeZone: "UTC" });
const eurCompact = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});

const SERIES = [
  { key: "invested", name: "Capital invertido", color: "var(--series-invested)", dash: "5 4" },
  { key: "currentValue", name: "Valor actual", color: "var(--series-value)", dash: undefined },
] as const;

interface TooltipProps {
  active?: boolean;
  payload?: readonly { payload?: PortfolioHistoryPoint }[];
}

function HistoryTooltip({ active, payload }: TooltipProps) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const diff = point.currentValue - point.invested;
  return (
    <div className="min-w-48 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
      <p className="mb-1.5 font-medium">{dayLong.format(new Date(point.date))}</p>
      <ul className="space-y-1">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            <span className="flex-1 text-muted-foreground">{s.name}</span>
            <span className="font-medium tabular-nums">{formatEur(point[s.key])}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 flex justify-between gap-4 border-t pt-1.5 text-muted-foreground">
        Ganancia / Pérdida
        <span
          className={cn(
            "font-medium tabular-nums",
            diff > 0 && "text-emerald-700 dark:text-emerald-400",
            diff < 0 && "text-red-700 dark:text-red-400",
          )}
        >
          {formatEurSigned(diff)}
        </span>
      </p>
    </div>
  );
}

/** Esqueleto con la forma de la tarjeta mientras llega la serie histórica. */
export function PortfolioHistorySkeleton() {
  return (
    <Card role="status" aria-label="Cargando evolución del patrimonio">
      <CardHeader>
        <div className="h-5 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-72 max-w-full animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
        <div className="h-72 animate-pulse rounded-lg bg-muted" />
      </CardContent>
    </Card>
  );
}

/** Evolución del capital invertido frente al valor de mercado de la cartera. */
export function PortfolioHistoryChart({ data }: { data: PortfolioHistoryPoint[] }) {
  // Historiales de más de ~4 meses: ticks mensuales; si no, día y mes.
  const spanDays = data.length > 1 ? (Date.parse(data.at(-1)!.date) - Date.parse(data[0].date)) / 86_400_000 : 0;
  const tickDate = (iso: string) => (spanDays > 120 ? monthShort : dayShort).format(new Date(iso));
  const last = data.at(-1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evolución del patrimonio</CardTitle>
        <CardDescription>
          Capital invertido frente al valor de mercado. Los valores intermedios se estiman interpolando entre los
          precios de tus operaciones y el precio actual.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className="h-72 [--series-invested:#64748b] [--series-value:#2563eb] dark:[--series-invested:#94a3b8] dark:[--series-value:#3b82f6]"
          role="img"
          aria-label={
            last
              ? `Gráfico de líneas: el ${dayLong.format(new Date(last.date))} el capital invertido es ${formatEur(last.invested)} y el valor actual ${formatEur(last.currentValue)}`
              : "Gráfico de evolución del patrimonio sin datos"
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tickFormatter={tickDate}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                minTickGap={32}
              />
              <YAxis
                tickFormatter={(v: number) => eurCompact.format(v)}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={64}
              />
              <Tooltip
                content={<HistoryTooltip />}
                cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }}
              />
              <Legend
                iconType="plainline"
                formatter={(value) => <span className="text-sm text-foreground">{value}</span>}
              />
              {SERIES.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={s.dash}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
