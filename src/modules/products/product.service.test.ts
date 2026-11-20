import test from "node:test";
import assert from "node:assert/strict";
import { computePrice, validateProductPricing } from "./product.service.js";

test("validateProductPricing accepts purchasePrice = 0 and coherent tiers", () => {
  assert.doesNotThrow(() =>
    validateProductPricing({
      purchasePrice: 0,
      salePrice: 1000,
      semiWholesaleMinQty: 10,
      semiWholesalePrice: 850,
      wholesaleMinQty: 50,
      wholesalePrice: 700,
    }),
  );
});

test("validateProductPricing rejects salePrice < purchasePrice", () => {
  assert.throws(
    () =>
      validateProductPricing({
        purchasePrice: 1000,
        salePrice: 900,
      }),
    /prix de vente ne peut pas être inférieur/i,
  );
});

test("validateProductPricing rejects incomplete or incoherent tiers", () => {
  assert.throws(
    () =>
      validateProductPricing({
        purchasePrice: 500,
        salePrice: 1000,
        semiWholesalePrice: 800,
        semiWholesaleMinQty: null,
      }),
    /Demi-gros requiert/i,
  );

  assert.throws(
    () =>
      validateProductPricing({
        purchasePrice: 500,
        salePrice: 1000,
        semiWholesaleMinQty: 20,
        semiWholesalePrice: 800,
        wholesaleMinQty: 10,
        wholesalePrice: 700,
      }),
    /quantité minimum Gros/i,
  );

  assert.throws(
    () =>
      validateProductPricing({
        purchasePrice: 500,
        salePrice: 1000,
        semiWholesaleMinQty: 10,
        semiWholesalePrice: 800,
        wholesaleMinQty: 50,
        wholesalePrice: 850,
      }),
    /prix Gros doit être strictement inférieur/i,
  );
});

test("computePrice picks wholesale > semiWholesale > detail", () => {
  const product = {
    salePrice: 1000,
    semiWholesaleMinQty: 10,
    semiWholesalePrice: 850,
    wholesaleMinQty: 50,
    wholesalePrice: 700,
  };

  assert.deepEqual(computePrice(product, 1), { price: 1000, tier: "detail" });
  assert.deepEqual(computePrice(product, 10), { price: 850, tier: "semiWholesale" });
  assert.deepEqual(computePrice(product, 50), { price: 700, tier: "wholesale" });
});
