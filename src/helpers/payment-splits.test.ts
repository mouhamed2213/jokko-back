import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePaymentSplits } from "./payment-splits.js";

describe("normalizePaymentSplits", () => {
  it("supports legacy single payment (amount + paymentMethod)", () => {
    const result = normalizePaymentSplits({
      amount: 1000,
      paymentMethod: "WAVE",
      maxAmount: 1000,
    });
    assert.equal(result.totalPaid, 1000);
    assert.deepEqual(result.splits, [{ paymentMethod: "WAVE", amount: 1000 }]);
  });

  it("supports split payment across multiple methods (CASH + WAVE)", () => {
    const result = normalizePaymentSplits({
      payments: [
        { paymentMethod: "CASH", amount: 500 },
        { paymentMethod: "WAVE", amount: 500 },
      ],
      maxAmount: 1000,
    });
    assert.equal(result.totalPaid, 1000);
    assert.deepEqual(result.splits, [
      { paymentMethod: "CASH", amount: 500 },
      { paymentMethod: "WAVE", amount: 500 },
    ]);
  });

  it("merges duplicate payment methods cleanly", () => {
    const result = normalizePaymentSplits({
      payments: [
        { paymentMethod: "CASH", amount: 300 },
        { paymentMethod: "WAVE", amount: 500 },
        { paymentMethod: "CASH", amount: 200 },
      ],
      maxAmount: 1000,
    });
    assert.equal(result.totalPaid, 1000);
    assert.deepEqual(result.splits, [
      { paymentMethod: "CASH", amount: 500 },
      { paymentMethod: "WAVE", amount: 500 },
    ]);
  });

  it("allows zero total when allowZero is true (credit sale)", () => {
    const result = normalizePaymentSplits({
      amount: 0,
      maxAmount: 1000,
      allowZero: true,
    });
    assert.equal(result.totalPaid, 0);
    assert.deepEqual(result.splits, []);
  });

  it("rejects total exceeding maxAmount", () => {
    assert.throws(
      () =>
        normalizePaymentSplits({
          payments: [
            { paymentMethod: "CASH", amount: 600 },
            { paymentMethod: "ORANGE_MONEY", amount: 500 },
          ],
          maxAmount: 1000,
        }),
      /dépasse/,
    );
  });

  it("rejects invalid paymentMethod or non-positive split amount", () => {
    assert.throws(
      () =>
        normalizePaymentSplits({
          payments: [{ paymentMethod: "BITCOIN", amount: 500 }],
        }),
      /invalide/,
    );
    assert.throws(
      () =>
        normalizePaymentSplits({
          payments: [{ paymentMethod: "CASH", amount: 0 }],
        }),
      /supérieur à 0/,
    );
  });
});
