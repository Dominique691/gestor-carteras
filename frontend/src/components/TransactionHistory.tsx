import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, formatEur, formatPrice, formatShares } from "@/lib/format";
import type { TransactionItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Operaciones visibles antes de pulsar «Ver todas». */
export const HISTORY_PREVIEW = 10;

interface Props {
  transactions: TransactionItem[];
}

export function TransactionHistory({ transactions }: Props) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? transactions : transactions.slice(0, HISTORY_PREVIEW);
  const hidden = transactions.length - visible.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de transacciones</CardTitle>
        <CardDescription>
          {transactions.length} {transactions.length === 1 ? "operación" : "operaciones"}, de la más reciente a la más
          antigua
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Operación</TableHead>
              <TableHead>Fondo</TableHead>
              <TableHead className="text-right">Participaciones</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead className="text-right">Importe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="tabular-nums" title={formatDateTime(t.transactionDate)}>
                  <time dateTime={t.transactionDate}>{formatDate(t.transactionDate)}</time>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="secondary"
                    className={cn(
                      t.type === "BUY"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
                    )}
                  >
                    {t.type === "BUY" ? "Compra" : "Venta"}
                  </Badge>
                </TableCell>
                <TableCell className="min-w-56 whitespace-normal font-medium">
                  {t.fundName}
                  <div className="font-mono text-xs font-normal text-muted-foreground">{t.isin}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatShares(t.shares)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPrice(t.pricePerShare)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatEur(t.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {transactions.length > HISTORY_PREVIEW && (
          <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Ver solo las últimas" : `Ver todas (${hidden} más)`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
