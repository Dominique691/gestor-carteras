import { Loader2, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { formatDecimal, formatEur, formatPrice, formatShares } from "@/lib/format";
import type { CreateTransactionBody, Fund, TransactionType } from "@/lib/types";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Hasta 4 decimales, como admite el backend. */
const DECIMAL = /^\d+([.,]\d{1,4})?$/;
const AMOUNT = /^\d+([.,]\d{1,2})?$/; // importes en €: hasta 2 decimales
const toNumber = (s: string) => Number(s.replace(",", "."));

type InputMode = "shares" | "amount";

interface Props {
  onCreated: () => void;
}

export function AddTransactionDialog({ onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [fundId, setFundId] = useState("");
  const [type, setType] = useState<TransactionType>("BUY");
  const [mode, setMode] = useState<InputMode>("shares");
  const [shares, setShares] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // El catálogo se carga la primera vez que se abre el modal.
  useEffect(() => {
    if (!open || funds.length > 0) return;
    api<Fund[]>("/api/funds")
      .then(setFunds)
      .catch(() => setError("No se pudo cargar el catálogo de fondos"));
  }, [open, funds.length]);

  function reset() {
    setFundId("");
    setType("BUY");
    setMode("shares");
    setShares("");
    setAmount("");
    setDate(todayISO());
    setError(null);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) reset();
  }

  // El precio no es editable: es siempre el valor liquidativo (NAV) actual del fondo elegido.
  const selectedFund = funds.find((f) => f.id === fundId);
  const price = selectedFund?.currentNAV ?? null;

  // Participaciones finales: las escritas, o importe ÷ precio redondeado a 4 decimales.
  let sharesNumber: number | null = null;
  if (mode === "shares") {
    if (DECIMAL.test(shares) && toNumber(shares) > 0) sharesNumber = toNumber(shares);
  } else if (AMOUNT.test(amount) && toNumber(amount) > 0 && price !== null) {
    const computed = Math.round((toNumber(amount) / price) * 1e4) / 1e4;
    if (computed > 0) sharesNumber = computed;
  }
  const total = sharesNumber !== null && price !== null ? sharesNumber * price : null;

  function changeMode(next: InputMode) {
    if (next === mode) return;
    // Conserva lo ya calculado: al cambiar de modo, el otro campo se rellena con su equivalente.
    if (next === "amount" && total !== null) setAmount(String(Math.round(total * 100) / 100));
    if (next === "shares" && sharesNumber !== null) setShares(String(sharesNumber));
    setMode(next);
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fundId) return setError("Selecciona un fondo");
    if (sharesNumber === null) {
      return setError(
        mode === "shares"
          ? "Introduce un número de participaciones válido (hasta 4 decimales)"
          : "Introduce un importe válido (hasta 2 decimales) que alcance al menos 0,0001 participaciones",
      );
    }
    if (!date || date > todayISO()) return setError("La fecha no puede ser futura");

    const body: CreateTransactionBody = {
      fundId,
      type,
      shares: sharesNumber,
      pricePerShare: price!, // seleccionado un fondo (comprobado arriba), el precio existe
    };
    // Para hoy se omite la fecha (el backend usa "ahora"); para días pasados, mediodía local.
    if (date !== todayISO()) body.transactionDate = new Date(`${date}T12:00:00`).toISOString();

    setLoading(true);
    try {
      await api("/api/transactions", { body });
      setOpen(false);
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) {
        setError([err.message, ...(err.details?.map((d) => d.message) ?? [])].join(". "));
      } else {
        setError("No se pudo conectar con el servidor");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Añadir transacción
        </Button>
      </DialogTrigger>
      <DialogContent className="grid-cols-[minmax(0,1fr)]">
        <form onSubmit={onSubmit} className="grid min-w-0 gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Añadir transacción</DialogTitle>
            <DialogDescription>Registra una compra o venta de participaciones.</DialogDescription>
          </DialogHeader>

          <div className="min-w-0 space-y-1.5">
            <label htmlFor="tx-type" className="text-sm font-medium">
              Operación
            </label>
            <Select value={type} onValueChange={(v) => setType(v as TransactionType)}>
              <SelectTrigger id="tx-type" className="w-full min-w-0 [&>span]:block! [&>span]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BUY">Compra</SelectItem>
                <SelectItem value="SELL">Venta</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 space-y-1.5">
            <label htmlFor="tx-fund" className="text-sm font-medium">
              Fondo
            </label>
            <Select value={fundId} onValueChange={setFundId}>
              <SelectTrigger id="tx-fund" className="w-full min-w-0 [&>span]:block! [&>span]:truncate">
                <SelectValue placeholder="Selecciona un fondo" />
              </SelectTrigger>
              <SelectContent>
                {funds.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 space-y-1.5">
            <span id="tx-mode-label" className="text-sm font-medium">
              Introducir por
            </span>
            <div role="group" aria-labelledby="tx-mode-label" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
              {(
                [
                  ["shares", "Participaciones"],
                  ["amount", "Importe (€)"],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={mode === value ? "default" : "ghost"}
                  aria-pressed={mode === value}
                  onClick={() => changeMode(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 items-end gap-4">
            <div className="min-w-0 space-y-1.5">
              {mode === "shares" ? (
                <>
                  <label htmlFor="tx-shares" className="text-sm font-medium">
                    Participaciones
                  </label>
                  <Input id="tx-shares" inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value)} />
                </>
              ) : (
                <>
                  <label htmlFor="tx-amount" className="text-sm font-medium">
                    Importe (€)
                  </label>
                  <Input id="tx-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </>
              )}
            </div>
            <div className="min-w-0 space-y-1.5">
              <label htmlFor="tx-price" className="text-sm font-medium">
                Precio participación (€)
              </label>
              <Input
                id="tx-price"
                readOnly
                tabIndex={-1}
                placeholder="—"
                className="cursor-default bg-muted/60 focus-visible:ring-0"
                value={price === null ? "" : formatDecimal(price)}
              />
            </div>
          </div>

          <div className="min-w-0 space-y-1.5">
            <label htmlFor="tx-date" className="text-sm font-medium">
              Fecha
            </label>
            <Input id="tx-date" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          {total !== null && sharesNumber !== null && (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {mode === "shares" ? (
                <>
                  Importe total: <span className="font-medium text-foreground">{formatEur(total)}</span>
                  {" · "}
                  {formatPrice(price!)} × {formatShares(sharesNumber)}
                </>
              ) : (
                <>
                  Participaciones:{" "}
                  <span className="font-medium text-foreground">{formatShares(sharesNumber)}</span>
                  {" · "}a {formatPrice(price!)} (importe real ≈ {formatEur(total)})
                </>
              )}
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="animate-spin" />}
              {type === "BUY" ? "Registrar compra" : "Registrar venta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
