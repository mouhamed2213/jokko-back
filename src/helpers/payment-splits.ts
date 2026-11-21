import { BadRequestError } from "../utils/errors.js";

export const VALID_PAYMENT_METHODS = [
  "CASH",
  "WAVE",
  "ORANGE_MONEY",
  "FREE_MONEY",
  "BANK",
  "OTHER",
] as const;

export type PaymentMethodCode = (typeof VALID_PAYMENT_METHODS)[number];

export type PaymentSplitInput = {
  paymentMethod?: string;
  amount?: number | string;
};

export type NormalizedPaymentSplit = {
  paymentMethod: PaymentMethodCode;
  amount: number;
};

export function isValidPaymentMethod(value: string): value is PaymentMethodCode {
  return (VALID_PAYMENT_METHODS as readonly string[]).includes(value);
}

/**
 * Normalise un paiement simple (amount + paymentMethod) OU un paiement multiple
 * (payments: [{ paymentMethod, amount }]).
 *
 * - Fusionne les lignes partageant le même moyen de paiement.
 * - Valide que chaque montant est > 0 et que la somme ne dépasse pas maxAmount.
 * - Reste 100% rétrocompatible avec l'ancien format mono-paiement.
 */
export function normalizePaymentSplits(options: {
  payments?: PaymentSplitInput[];
  amount?: number | string;
  paymentMethod?: string;
  maxAmount?: number;
  allowZero?: boolean;
}): { splits: NormalizedPaymentSplit[]; totalPaid: number } {
  const {
    payments,
    amount,
    paymentMethod,
    maxAmount,
    allowZero = false,
  } = options;

  let splits: NormalizedPaymentSplit[] = [];

  if (Array.isArray(payments) && payments.length > 0) {
    const merged = new Map<PaymentMethodCode, number>();

    for (const entry of payments) {
      const rawMethod = String(entry?.paymentMethod || "").trim().toUpperCase();
      if (!isValidPaymentMethod(rawMethod)) {
        throw new BadRequestError(
          `Moyen de paiement invalide : "${entry?.paymentMethod ?? ""}"`,
        );
      }

      const rawAmount = Number(entry?.amount);
      if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
        throw new BadRequestError(
          "Chaque ligne de paiement doit avoir un montant supérieur à 0",
        );
      }

      merged.set(rawMethod, (merged.get(rawMethod) ?? 0) + rawAmount);
    }

    splits = Array.from(merged.entries()).map(([method, sum]) => ({
      paymentMethod: method,
      amount: Math.round(sum * 100) / 100,
    }));
  } else {
    const rawAmount =
      amount !== undefined && amount !== null && amount !== ""
        ? Number(amount)
        : 0;

    if (!Number.isFinite(rawAmount) || rawAmount < 0) {
      throw new BadRequestError("Montant payé invalide");
    }

    if (rawAmount > 0) {
      const rawMethod = String(paymentMethod || "CASH").trim().toUpperCase();
      const method: PaymentMethodCode = isValidPaymentMethod(rawMethod)
        ? rawMethod
        : "CASH";
      splits = [{ paymentMethod: method, amount: rawAmount }];
    }
  }

  const totalPaid =
    Math.round(splits.reduce((sum, s) => sum + s.amount, 0) * 100) / 100;

  if (!allowZero && totalPaid <= 0) {
    throw new BadRequestError("Montant invalide");
  }

  if (maxAmount !== undefined && totalPaid > maxAmount + 0.001) {
    throw new BadRequestError(
      `Le montant payé (${totalPaid} FCFA) dépasse le montant attendu (${maxAmount} FCFA)`,
    );
  }

  return { splits, totalPaid };
}
