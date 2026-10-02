import { CheckCircle2, Loader2, Play } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/api";
import { formatEur, formatPrice, formatShares } from "@/lib/format";
import type { PlannedPurchase } from "@/lib/rebalance";

interface Props {
  plan: PlannedPurchase[];
  fundNames: Map<string, string>;
  disabled: boolean;
  /** Persiste los objetivos si hay cambios sin guardar. */
  onBeforeExecute: () => Promise<void>;
  /** Crea una compra; debe lanzar si el backend la rechaza. */
  onCreateTransaction: (p: PlannedPurchase) => Promise<void>;
  /** Se llama una vez creadas todas las compras. */
  onDone: () => void;
  hasUnsavedTargets: boolean;
}

export function ExecuteRebalanceDialog({
  plan,
  fundNames,
  disabled,
  onBeforeExecute,
  onCreateTransaction,
  onDone,
  hasUnsavedTargets,
}: Props) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [created, setCreated] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const total = plan.reduce((s, p) => s + p.amount, 0);
  const finished = created === plan.length && plan.length > 0 && !error;

  function onOpenChange(next: boolean) {
    if (running) return; // no se cierra a mitad de ejecución
    setOpen(next);
    if (next) {
      setCreated(0);
      setError(null);
    } else if (created > 0) {
      onDone(); // refresca los datos si se llegó a crear alguna compra
    }
  }

  async function execute() {
    setRunning(true);
    setError(null);
    let done = created;
    try {
      await onBeforeExecute();
      // Secuencial: si una falla se detiene y se informa de cuántas se crearon.
      for (const p of plan.slice(created)) {
        await onCreateTransaction(p);
        done += 1;
        setCreated(done);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "No se pudo conectar con el servidor";
      setError(
        done > 0 ? `${msg}. Se crearon ${done} de ${plan.length} compras; puedes reintentar las restantes.` : msg,
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="lg" disabled={disabled}>
          <Play /> Ejecutar rebalanceo
        </Button>
      </DialogTrigger>
      <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{finished ? "Rebalanceo ejecutado" : "Simulación de rebalanceo"}</DialogTitle>
          <DialogDescription>
            {finished
              ? "Las compras se han registrado en tu cartera."
              : "Estas son las compras necesarias, al valor actual de cada fondo. No se crea nada hasta que lo confirmes."}
          </DialogDescription>
        </DialogHeader>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fondo</TableHead>
              <TableHead className="text-right">Importe</TableHead>
              <TableHead className="text-right">Participaciones</TableHead>
              <TableHead className="text-right">Precio</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.map((p, i) => (
              <TableRow key={p.fundId}>
                <TableCell className="whitespace-normal font-medium">
                  {fundNames.get(p.fundId)}
                  {i < created && <CheckCircle2 className="ml-2 inline size-4 text-emerald-600" aria-label="Creada" />}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatEur(p.amount)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatShares(p.shares)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPrice(p.pricePerShare)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">Total</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatEur(total)}</TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableFooter>
        </Table>

        {hasUnsavedTargets && !finished && (
          <p className="text-sm text-muted-foreground">Se guardarán también tus nuevos porcentajes objetivo.</p>
        )}
        {finished && (
          <p role="status" className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            Rebalanceo completado: {plan.length} {plan.length === 1 ? "compra creada" : "compras creadas"}.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={running} onClick={() => onOpenChange(false)}>
            {finished ? "Cerrar" : "Cancelar"}
          </Button>
          {!finished && (
            <Button onClick={execute} disabled={running || plan.length === 0}>
              {running && <Loader2 className="animate-spin" />}
              {created > 0 ? "Reintentar restantes" : "Crear transacciones"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
