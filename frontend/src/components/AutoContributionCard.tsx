import { CalendarClock, Loader2, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { formatEur } from "@/lib/format";
import { parseDecimal } from "@/lib/rebalance";
import type { ContributionFrequency, ContributionPlan, Contributions } from "@/lib/types";
import { cn } from "@/lib/utils";

export const FREQUENCY_LABELS: Record<ContributionFrequency, string> = {
  MONTHLY: "Mensual",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

// Las fechas llegan como YYYY-MM-DD (UTC): se formatean en UTC para que no cambien de día según la zona horaria.
const dayFormat = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const formatDay = (isoDay: string) => dayFormat.format(new Date(`${isoDay}T00:00:00Z`));

/** Fecha local de hoy en formato YYYY-MM-DD (valor por defecto del campo de fecha). */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  /** Sin objetivos guardados no se puede activar: el reparto se hace con ellos. */
  hasSavedTargets: boolean;
  hasUnsavedTargets: boolean;
  /** Importe escrito en «Nueva Aportación»: es también el de la aportación periódica. */
  amount: string;
  onAmountChange: (value: string) => void;
  /** Se llama cuando una aportación se ha ejecutado al guardar (para refrescar la cartera). */
  onExecuted: () => void;
}

/**
 * Aportación periódica dentro de «Nueva Aportación»: un interruptor despliega la frecuencia y la primera fecha
 * junto al importe de arriba. Las aportaciones se reparten solas con los objetivos guardados.
 */
export function AutoContributionCard({ hasSavedTargets, hasUnsavedTargets, amount, onAmountChange, onExecuted }: Props) {
  const [data, setData] = useState<Contributions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<ContributionFrequency>("MONTHLY");
  const [startDate, setStartDate] = useState(localToday);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Contributions>("/api/contributions")
      .then((d) => {
        setData(d);
        setLoadError(null);
      })
      .catch(() => setLoadError("No se pudo cargar la aportación automática"));
  }, []);

  const plan = data?.plan ?? null;
  const showForm = editing || (data !== null && !plan && enabled);

  function startEditing(p: ContributionPlan) {
    onAmountChange(String(p.amount).replace(".", ","));
    setFrequency(p.frequency);
    setStartDate(p.startDate);
    setError(null);
    setEditing(true);
  }

  async function save(body: { amount: number; frequency: ContributionFrequency; startDate: string; active: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const runsBefore = data?.runs.length ?? 0;
      const next = await api<Contributions>("/api/contributions", { method: "PUT", body });
      setData(next);
      setEditing(false);
      if (next.runs.length > runsBefore) onExecuted();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.details?.map((d) => d.message).join(". ") || err.message
          : "No se pudo conectar con el servidor",
      );
    } finally {
      setBusy(false);
    }
  }

  const amountValue = parseDecimal(amount, 2);
  const amountOk = amountValue !== null && amountValue >= 1;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!amountOk || !startDate) return;
    save({ amount: amountValue!, frequency, startDate, active: true });
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/contributions", { method: "DELETE" });
      setData((d) => (d ? { ...d, plan: null } : d));
      setEditing(false);
      setEnabled(false);
      setFrequency("MONTHLY");
      setStartDate(localToday());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="auto-title" className="space-y-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="auto-title" className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="size-4 text-primary" aria-hidden /> Aportación automática
          </h3>
          <p className="text-sm text-muted-foreground">
            Repite esta aportación cada cierto tiempo. Se reparte entre tus fondos según los objetivos guardados y las
            compras se registran solas al precio de ese momento.
          </p>
        </div>
        {data && !plan && (
          <label className="flex items-center gap-2 text-sm font-medium">
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Repetir automáticamente" disabled={busy} />
            Repetir automáticamente
          </label>
        )}
      </div>
      <div className="space-y-4">
        {loadError && (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        )}
        {!data && !loadError && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Cargando…
          </p>
        )}

        {plan && !editing && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1">
              <p className="flex flex-wrap items-center gap-2 text-lg font-semibold tabular-nums">
                {formatEur(plan.amount)}
                <span className="text-base font-normal text-muted-foreground">
                  · {FREQUENCY_LABELS[plan.frequency].toLowerCase()}
                </span>
                <Badge
                  variant="secondary"
                  className={cn(
                    plan.active && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
                  )}
                >
                  {plan.active ? "Activa" : "Pausada"}
                </Badge>
              </p>
              <p className="text-sm text-muted-foreground">
                {plan.nextRunAt ? (
                  <>
                    Próxima aportación: <time dateTime={plan.nextRunAt}>{formatDay(plan.nextRunAt)}</time>
                  </>
                ) : (
                  "En pausa: no se hará ninguna aportación hasta que la reanudes."
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => startEditing(plan)} disabled={busy}>
                <Pencil /> Editar
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || (!plan.active && !hasSavedTargets)}
                onClick={() => save({ ...plan, active: !plan.active })}
              >
                {plan.active ? (
                  <>
                    <Pause /> Pausar
                  </>
                ) : (
                  <>
                    <Play /> Reanudar
                  </>
                )}
              </Button>
              <Button variant="ghost" size="sm" onClick={remove} disabled={busy} className="text-destructive">
                <Trash2 /> Eliminar
              </Button>
            </div>
          </div>
        )}

        {showForm && (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <span id="auto-frequency-label" className="text-sm font-medium">
                  Frecuencia
                </span>
                <Select value={frequency} onValueChange={(v) => setFrequency(v as ContributionFrequency)}>
                  <SelectTrigger aria-labelledby="auto-frequency-label" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FREQUENCY_LABELS) as ContributionFrequency[]).map((f) => (
                      <SelectItem key={f} value={f}>
                        {FREQUENCY_LABELS[f]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="auto-start" className="text-sm font-medium">
                  Primera aportación
                </label>
                <Input
                  id="auto-start"
                  type="date"
                  min={plan ? undefined : localToday()}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
            </div>
            {!amountOk && (
              <p role="alert" className="text-sm text-destructive">
                Introduce arriba un importe de al menos 1 € (hasta 2 decimales) para programar la aportación.
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Las siguientes aportaciones caerán el mismo día del mes (o el último, si ese mes es más corto). Si la
              primera es hoy, se ejecuta al guardar.
            </p>
            {!hasSavedTargets ? (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Guarda primero tus porcentajes objetivo: la aportación se reparte con ellos.
              </p>
            ) : (
              hasUnsavedTargets && (
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  Tienes cambios sin guardar en los objetivos: las aportaciones usarán los objetivos guardados.
                </p>
              )
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !amountOk || !startDate || !hasSavedTargets}>
                {busy && <Loader2 className="animate-spin" />}
                {plan ? "Guardar cambios" : "Activar aportación automática"}
              </Button>
              {editing && plan && (
                <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={busy}>
                  Cancelar
                </Button>
              )}
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {data && data.runs.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Últimas aportaciones automáticas</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums">
                      <time dateTime={r.scheduledFor}>{formatDay(r.scheduledFor)}</time>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatEur(r.amount)}</TableCell>
                    <TableCell className="whitespace-normal">
                      {r.status === "SUCCESS" ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          {r.purchases} {r.purchases === 1 ? "compra registrada" : "compras registradas"}
                        </span>
                      ) : (
                        <span className="text-destructive">No se ejecutó: {r.message}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </section>
  );
}
