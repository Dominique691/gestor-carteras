import type { Frequency } from "./contributions.calc.js";

export interface ContributionPlanDto {
  /** Importe de cada aportación, en €. */
  amount: number;
  frequency: Frequency;
  /** Fecha de la primera aportación (YYYY-MM-DD); marca el día del mes de las siguientes. */
  startDate: string;
  active: boolean;
  /** Próxima ejecución (YYYY-MM-DD), o null si el plan está pausado. */
  nextRunAt: string | null;
}

export interface ContributionRunDto {
  id: string;
  /** Fecha programada (YYYY-MM-DD). */
  scheduledFor: string;
  /** Momento real de ejecución (ISO 8601). */
  executedAt: string;
  amount: number;
  status: "SUCCESS" | "FAILED";
  /** Número de compras creadas. */
  purchases: number;
  message: string | null;
}

export interface ContributionsDto {
  plan: ContributionPlanDto | null;
  /** Últimas ejecuciones, de la más reciente a la más antigua. */
  runs: ContributionRunDto[];
}

export interface SetContributionPlanRequestDto {
  amount: number | string;
  frequency: Frequency;
  startDate: string;
  active?: boolean;
}
