import { describe, expect, it } from "vitest";
import { Decimal } from "../../lib/decimal.js";
import { InsufficientSharesError, replay, type TxInput } from "./portfolio.calc.js";

const tx = (id: string, type: "BUY" | "SELL", shares: number, price: number, day: number): TxInput => ({
  id,
  fundId: "f1",
  type,
  shares: new Decimal(shares),
  pricePerShare: new Decimal(price),
  transactionDate: new Date(Date.UTC(2026, 0, day)),
});

describe("replay", () => {
  it("calcula coste medio y P&L realizado tras una venta parcial", () => {
    const h = replay([tx("a", "BUY", 2, 500, 1), tx("b", "BUY", 1, 520, 2), tx("c", "SELL", 1, 530, 3)]).get("f1")!;
    expect(h.shares.toString()).toBe("2");
    expect(h.cost.toDecimalPlaces(2).toString()).toBe("1013.33");
    expect(h.realizedPnl.toDecimalPlaces(2).toString()).toBe("23.33");
  });

  it("rechaza vender más de lo que se posee", () => {
    expect(() => replay([tx("a", "BUY", 1, 100, 1), tx("b", "SELL", 2, 100, 2)])).toThrow(InsufficientSharesError);
  });

  it("rechaza una venta anterior a la compra", () => {
    expect(() => replay([tx("a", "BUY", 1, 100, 5), tx("b", "SELL", 1, 100, 1)])).toThrow(InsufficientSharesError);
  });
});
