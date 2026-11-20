export interface ProfitInput {
  revenue: number;
  costOfGoodsSold: number;
  operatingExpenses: number;
}

export interface ProfitMetrics {
  costOfGoodsSold: number;
  grossProfit: number;
  marginRate: number | null;
  operatingExpenses: number;
  netProfit: number;
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

/**
 * Calcule de façon cohérente et transparente les indicateurs de rentabilité :
 * - Bénéfice brut = Chiffre d'affaires - Coût des marchandises vendues (CMV)
 * - Taux de marge = (Bénéfice brut / CA) * 100 (null si CA <= 0)
 * - Résultat net = Bénéfice brut - Autres dépenses de caisse (hors fournisseurs & annulations)
 */
export function computeProfitMetrics({
  revenue,
  costOfGoodsSold,
  operatingExpenses,
}: ProfitInput): ProfitMetrics {
  const safeRevenue = Number.isFinite(revenue) ? revenue : 0;
  const safeCogs = Number.isFinite(costOfGoodsSold) ? costOfGoodsSold : 0;
  const safeExpenses = Number.isFinite(operatingExpenses) ? operatingExpenses : 0;

  const grossProfit = safeRevenue - safeCogs;
  const netProfit = grossProfit - safeExpenses;
  const marginRate =
    safeRevenue > 0 ? roundMoney((grossProfit / safeRevenue) * 100) : null;

  return {
    costOfGoodsSold: roundMoney(safeCogs),
    grossProfit: roundMoney(grossProfit),
    marginRate,
    operatingExpenses: roundMoney(safeExpenses),
    netProfit: roundMoney(netProfit),
  };
}
