import { AlertTriangle, CheckCircle2, Euro, Loader2, Plus, Save, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExecuteRebalanceDialog } from "@/components/ExecuteRebalanceDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, ApiError } from "@/lib/api";
import { formatEur, formatPercent } from "@/lib/format";
import { computeRebalance, parseDecimal, planPurchases, type PlannedPurchase } from "@/lib/rebalance";
import type { Fund, Portfolio } from "@/lib/types";
import { cn } from "@/lib/utils";

const toCents = (n: number) => Math.round(n * 100);

export default function Rebalance() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [rowIds, setRowIds] = useState<string[]>([]); // fondos mostrados en el formulario de objetivos
  const [draft, setDraft] = useState<Record<string, string>>({}); // % objetivo escrito, por fondo
  const [contribution, setContribution] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (resetDraft: boolean) => {
    try {
      const [p, f] = await Promise.all([api<Portfolio>("/api/portfolio"), api<Fund[]>("/api/funds")]);
      setPortfolio(p);
      setFunds(f);
      setLoadError(null);
      if (resetDraft) {
        const ids = [...new Set([...p.positions.map((x) => x.fundId), ...p.targets.map((t) => t.fundId)])];
        setRowIds(ids);
        setDraft(Object.fromEntries(ids.map((id) => [id, String(p.targets.find((t) => t.fundId === id)?.targetPercentage ?? 0)])));
      }
    } catch {
      setLoadError("No se pudieron cargar los datos de la cartera");
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  const fundById = useMemo(() => new Map(funds.map((f) => [f.id, f])), [funds]);
  const positionById = useMemo(() => new Map((portfolio?.positions ?? []).map((p) => [p.fundId, p])), [portfolio]);

  // --- objetivos (borrador) ---
  const parsed = rowIds.map((id) => {
    const v = parseDecimal(draft[id] ?? "", 2);
    return { id, value: v !== null && v <= 100 ? v : null };
  });
  const allValid = parsed.every((p) => p.value !== null);
  const sumCents = parsed.reduce((s, p) => s + (p.value === null ? 0 : toCents(p.value)), 0);
  const balanced = allValid && rowIds.length > 0 && sumCents === 10000;

  const savedCents = new Map((portfolio?.targets ?? []).map((t) => [t.fundId, toCents(t.targetPercentage)]));
  const draftCents = new Map(parsed.filter((p) => p.value && p.value > 0).map((p) => [p.id, toCents(p.value!)]));
  const hasUnsaved =
    savedCents.size !== draftCents.size || [...draftCents].some(([id, c]) => savedCents.get(id) !== c);

  // --- aportación y resultado ---
  const contributionValue = contribution.trim() === "" ? 0 : parseDecimal(contribution, 2);

  const result = useMemo(() => {
    if (!balanced || contributionValue === null) return null;
    return computeRebalance(
      parsed.map((p) => ({
        fundId: p.id,
        currentValue: positionById.get(p.id)?.currentValue ?? 0,
        targetPercentage: p.value ?? 0,
      })),
      contributionValue,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balanced, contributionValue, draft, rowIds, positionById]);

  const plan = useMemo<PlannedPurchase[]>(
    () => (result ? planPurchases(result.rows, new Map(funds.map((f) => [f.id, f.currentNAV]))) : []),
    [result, funds],
  );

  const infoOf = (id: string) => {
    const pos = positionById.get(id);
    const fund = fundById.get(id);
    return { name: pos?.name ?? fund?.name ?? id, isin: pos?.isin ?? fund?.isin ?? "", category: pos?.category ?? fund?.category ?? "" };
  };
  const fundNames = useMemo(() => new Map(rowIds.map((id) => [id, infoOf(id).name])), [rowIds, positionById, fundById]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- acciones ---
  async function saveTargets() {
    setSaving(true);
    setSaveMessage(null);
    try {
      await api("/api/portfolio/targets", {
        body: { targets: [...draftCents].map(([fundId, c]) => ({ fundId, targetPercentage: c / 100 })) },
      });
      await load(false);
      setSaveMessage({ ok: true, text: "Objetivos guardados" });
    } catch (err) {
      setSaveMessage({ ok: false, text: err instanceof ApiError ? err.message : "No se pudo conectar con el servidor" });
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function createPurchase(p: PlannedPurchase) {
    await api("/api/transactions", {
      body: { fundId: p.fundId, type: "BUY", shares: p.shares, pricePerShare: p.pricePerShare },
    });
  }

  function addFund(id: string) {
    setRowIds((ids) => [...ids, id]);
    setDraft((d) => ({ ...d, [id]: "0" }));
  }

  function removeFund(id: string) {
    setRowIds((ids) => ids.filter((x) => x !== id));
    setDraft(({ [id]: _removed, ...rest }) => rest);
  }

  const availableFunds = funds.filter((f) => !rowIds.includes(f.id));
  const diffPct = (10000 - sumCents) / 100;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Rebalanceo</h1>
        <p className="text-sm text-muted-foreground">Simula una aportación y descubre dónde invertirla</p>
      </div>

      {loadError && (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      )}
      {!portfolio && !loadError && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" /> Cargando…
        </div>
      )}

      {portfolio && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                <label htmlFor="contribution">Nueva Aportación (€)</label>
              </CardTitle>
              <CardDescription>
                Patrimonio actual: {formatEur(portfolio.totalValue)}. Las sugerencias se reparten sin vender nada.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative max-w-sm">
                <Euro className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="contribution"
                  inputMode="decimal"
                  placeholder="0,00"
                  className="h-14 pl-12 text-2xl font-semibold tabular-nums"
                  aria-invalid={contributionValue === null}
                  value={contribution}
                  onChange={(e) => setContribution(e.target.value)}
                />
              </div>
              {contributionValue === null && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  Introduce un importe válido (hasta 2 decimales).
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Porcentajes objetivo</CardTitle>
              <CardDescription>Reparte el 100 % de tu cartera entre los fondos.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {rowIds.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fondo</TableHead>
                      <TableHead>Categoría</TableHead>
                      <TableHead className="text-right">% Actual</TableHead>
                      <TableHead className="w-32 text-right">% Target</TableHead>
                      <TableHead className="w-10">
                        <span className="sr-only">Quitar</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rowIds.map((id) => {
                      const info = infoOf(id);
                      const pos = positionById.get(id);
                      const invalid = parsed.find((p) => p.id === id)?.value === null;
                      return (
                        <TableRow key={id}>
                          <TableCell className="whitespace-normal font-medium">
                            {info.name}
                            <div className="font-mono text-xs font-normal text-muted-foreground">{info.isin}</div>
                          </TableCell>
                          <TableCell>{info.category}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatPercent(pos?.portfolioPercentage ?? 0)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Input
                              aria-label={`% objetivo de ${info.name}`}
                              inputMode="decimal"
                              className="ml-auto w-24 text-right tabular-nums"
                              aria-invalid={invalid}
                              value={draft[id] ?? ""}
                              onChange={(e) => setDraft((d) => ({ ...d, [id]: e.target.value }))}
                            />
                          </TableCell>
                          <TableCell>
                            {!pos && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Quitar ${info.name}`}
                                onClick={() => removeFund(id)}
                              >
                                <X />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3} className="font-medium">
                        Suma de objetivos
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium tabular-nums",
                          balanced ? "text-emerald-700 dark:text-emerald-400" : "text-destructive",
                        )}
                      >
                        {allValid ? formatPercent(sumCents / 100) : "—"}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Select value="" onValueChange={addFund} disabled={availableFunds.length === 0}>
                  <SelectTrigger aria-label="Añadir fondo" className="w-72 min-w-0 [&>span]:block! [&>span]:truncate">
                    <Plus className="size-4" />
                    <SelectValue placeholder="Añadir fondo al reparto" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableFunds.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <p
                  role="status"
                  className={cn(
                    "flex items-center gap-1.5 text-sm",
                    balanced ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400",
                  )}
                >
                  {balanced ? (
                    <>
                      <CheckCircle2 className="size-4" /> Los objetivos suman 100 %
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="size-4" />
                      {!allValid
                        ? "Hay porcentajes no válidos (0-100, hasta 2 decimales)"
                        : rowIds.length === 0
                          ? "Añade al menos un fondo"
                          : diffPct > 0
                            ? `Faltan ${formatPercent(diffPct)} para llegar a 100 %`
                            : `Sobran ${formatPercent(-diffPct)} sobre 100 %`}
                    </>
                  )}
                </p>

                <Button
                  variant="secondary"
                  className="ml-auto"
                  disabled={!balanced || !hasUnsaved || saving}
                  onClick={() => saveTargets().catch(() => {})}
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Save />} Guardar objetivos
                </Button>
              </div>
              {saveMessage && (
                <p role={saveMessage.ok ? "status" : "alert"} className={cn("text-sm", saveMessage.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>
                  {saveMessage.text}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Resultado</CardTitle>
              <CardDescription>Comparativa entre tu cartera actual y los objetivos</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!result ? (
                <p className="text-sm text-muted-foreground">
                  {contributionValue === null
                    ? "Corrige la aportación para ver el resultado."
                    : "Ajusta los objetivos hasta que sumen 100 % para ver el resultado."}
                </p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fondo</TableHead>
                        <TableHead>Categoría</TableHead>
                        <TableHead className="text-right">% Actual</TableHead>
                        <TableHead className="text-right">% Objetivo</TableHead>
                        <TableHead className="text-right">Valor Actual</TableHead>
                        <TableHead className="text-right">Aportación Sugerida (€)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.rows.map((r) => {
                        const info = infoOf(r.fundId);
                        return (
                          <TableRow key={r.fundId}>
                            <TableCell className="whitespace-normal font-medium">{info.name}</TableCell>
                            <TableCell>{info.category}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatPercent(r.currentPercentage)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatPercent(r.targetPercentage)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatEur(r.currentValue)}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.contribution > 0 ? (
                                <Badge className="bg-emerald-100 text-emerald-800 tabular-nums dark:bg-emerald-950 dark:text-emerald-300">
                                  + {formatEur(r.contribution)}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={4} className="font-medium">
                          Total
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatEur(result.totalValue)}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatEur(result.rows.reduce((s, r) => s + r.contribution, 0))}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      Patrimonio tras la aportación: <span className="font-medium text-foreground">{formatEur(result.targetTotal)}</span>
                    </p>
                    <ExecuteRebalanceDialog
                      plan={plan}
                      fundNames={fundNames}
                      disabled={plan.length === 0}
                      hasUnsavedTargets={hasUnsaved}
                      onBeforeExecute={async () => {
                        if (hasUnsaved) await saveTargets();
                      }}
                      onCreateTransaction={createPurchase}
                      onDone={() => {
                        setContribution("");
                        load(true);
                      }}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
