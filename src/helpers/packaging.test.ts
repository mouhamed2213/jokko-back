import test from "node:test";
import assert from "node:assert/strict";
import {
  computePriceForUnit,
  resolvePackagingPrices,
  resolveUnitsPerPack,
} from "./packaging.js";

test("resolveUnitsPerPack handles PIECE, DOZEN and CARTON", () => {
  assert.equal(resolveUnitsPerPack("PIECE"), 1);
  assert.equal(resolveUnitsPerPack("DOZEN"), 12);
  assert.equal(resolveUnitsPerPack("CARTON", 24), 24);
  assert.throws(() => resolveUnitsPerPack("CARTON", 1), /entier ≥ 2/i);
  assert.throws(() => resolveUnitsPerPack("CARTON", undefined), /entier ≥ 2/i);
});

test("resolvePackagingPrices keeps stock valuation exact for CARTON and DOZEN", () => {
  // 10 cartons de 24 pièces à 12 000 FCFA le carton = 120 000 FCFA
  const carton = resolvePackagingPrices({
    unitType: "CARTON",
    unitsPerPack: 24,
    packPurchasePrice: 12000,
    packSalePrice: 14400,
    salePrice: 700, // prix pièce explicite
  });

  assert.equal(carton.purchasePrice, 500); // 12000 / 24
  assert.equal(carton.salePrice, 700);
  assert.equal(carton.packPurchasePrice, 12000);
  assert.equal(carton.packSalePrice, 14400);
  // Invariant comptable : (10 * 24) * purchasePrice === 10 * 12000
  assert.equal(240 * carton.purchasePrice, 120000);

  // Douzaine sans prix pièce explicite -> calcul automatique
  const dozen = resolvePackagingPrices({
    unitType: "DOZEN",
    unitsPerPack: 12,
    packPurchasePrice: 6000,
    packSalePrice: 7200,
  });

  assert.equal(dozen.purchasePrice, 500);
  assert.equal(dozen.salePrice, 600);
  assert.equal(36 * dozen.purchasePrice, 18000); // 3 douzaines * 6000
});

test("computePriceForUnit applies tiers on primary unit and detail price on pieces", () => {
  const cartonProduct = {
    unitType: "CARTON" as const,
    unitsPerPack: 24,
    salePrice: 700,
    packSalePrice: 14400,
    semiWholesaleMinQty: 5,
    semiWholesalePrice: 13500,
    wholesaleMinQty: 10,
    wholesalePrice: 12500,
  };

  // Vente au carton : détail, demi-gros, gros
  assert.deepEqual(computePriceForUnit(cartonProduct, 2, "CARTON"), {
    price: 14400,
    tier: "detail",
    soldUnit: "CARTON",
    piecesCount: 48,
  });
  assert.deepEqual(computePriceForUnit(cartonProduct, 5, "CARTON"), {
    price: 13500,
    tier: "semiWholesale",
    soldUnit: "CARTON",
    piecesCount: 120,
  });
  assert.deepEqual(computePriceForUnit(cartonProduct, 10, "CARTON"), {
    price: 12500,
    tier: "wholesale",
    soldUnit: "CARTON",
    piecesCount: 240,
  });

  // Vente à la pièce d'un produit en carton
  assert.deepEqual(computePriceForUnit(cartonProduct, 6, "PIECE"), {
    price: 700,
    tier: "detail",
    soldUnit: "PIECE",
    piecesCount: 6,
  });

  // Refus d'une unité incompatible (vendre en DOZEN un produit CARTON)
  assert.throws(
    () => computePriceForUnit(cartonProduct, 1, "DOZEN"),
    /ne peut pas être vendu en douzaine/i,
  );
});
