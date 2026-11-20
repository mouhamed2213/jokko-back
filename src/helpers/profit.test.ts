import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeProfitMetrics } from "./profit.js";

describe("computeProfitMetrics", () => {
  it("computes gross profit, margin rate and net profit accurately", () => {
    const result = computeProfitMetrics({
      revenue: 500000,
      costOfGoodsSold: 320000,
      operatingExpenses: 45000,
    });

    assert.equal(result.costOfGoodsSold, 320000);
    assert.equal(result.grossProfit, 180000);
    assert.equal(result.marginRate, 36);
    assert.equal(result.operatingExpenses, 45000);
    assert.equal(result.netProfit, 135000);
  });

  it("returns null marginRate when revenue is zero", () => {
    const result = computeProfitMetrics({
      revenue: 0,
      costOfGoodsSold: 0,
      operatingExpenses: 15000,
    });

    assert.equal(result.grossProfit, 0);
    assert.equal(result.marginRate, null);
    assert.equal(result.netProfit, -15000);
  });

  it("handles negative net profit cleanly without rounding drift", () => {
    const result = computeProfitMetrics({
      revenue: 100000.1,
      costOfGoodsSold: 80000.2,
      operatingExpenses: 30000.05,
    });

    assert.equal(result.grossProfit, 19999.9);
    assert.equal(result.netProfit, -10000.15);
    assert.equal(result.marginRate, 20);
  });
});
