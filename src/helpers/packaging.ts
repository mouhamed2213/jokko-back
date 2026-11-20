import { PackagingUnit } from "../database/prisma/generated/prisma/enums.js";
import { BadRequestError } from "../utils/errors.js";

export type PriceTier = "detail" | "semiWholesale" | "wholesale";

export function parsePackagingUnit(value: unknown): PackagingUnit {
  if (value === undefined || value === null || value === "") return "PIECE";
  if (value === "PIECE" || value === "DOZEN" || value === "CARTON") {
    return value;
  }
  throw new BadRequestError(
    `Unité de conditionnement invalide "${String(value)}". Utilisez PIECE, DOZEN ou CARTON.`,
  );
}

export function resolveUnitsPerPack(
  unitType: PackagingUnit,
  rawUnitsPerPack?: number | null,
): number {
  if (unitType === "PIECE") return 1;
  if (unitType === "DOZEN") return 12;

  const parsed = Number(rawUnitsPerPack);
  if (!Number.isInteger(parsed) || parsed < 2) {
    throw new BadRequestError(
      "Pour un produit vendu par carton, le nombre de pièces par carton doit être un entier ≥ 2.",
    );
  }
  return parsed;
}

export function getUnitLabel(unit: PackagingUnit, plural = false): string {
  if (unit === "DOZEN") return plural ? "douzaines" : "douzaine";
  if (unit === "CARTON") return plural ? "cartons" : "carton";
  return plural ? "pièces" : "pièce";
}

export type PackagingPriceResolutionInput = {
  unitType: PackagingUnit;
  unitsPerPack: number;
  purchasePrice?: number | null;
  salePrice?: number | null;
  packPurchasePrice?: number | null;
  packSalePrice?: number | null;
};

/**
 * Calcule de façon cohérente les prix par pièce (utilisés pour la valorisation, les marges
 * et la vente à la pièce) et les prix par conditionnement (carton / douzaine).
 *
 * Invariant comptable :
 *   quantity (en pièces) * purchasePrice (par pièce) === nbConditionnements * packPurchasePrice
 */
export function resolvePackagingPrices(input: PackagingPriceResolutionInput) {
  const { unitType, unitsPerPack } = input;

  if (unitType === "PIECE") {
    const purchasePrice = Number(input.purchasePrice);
    const salePrice = Number(input.salePrice);
    return {
      purchasePrice,
      salePrice,
      packPurchasePrice: null as number | null,
      packSalePrice: null as number | null,
      tierBasePurchase: purchasePrice,
      tierBaseSale: salePrice,
    };
  }

  // DOZEN ou CARTON : le commerçant saisit le prix d'achat et de vente du conditionnement
  const packPurchasePrice =
    input.packPurchasePrice !== undefined && input.packPurchasePrice !== null
      ? Number(input.packPurchasePrice)
      : Number(input.purchasePrice);

  const packSalePrice =
    input.packSalePrice !== undefined && input.packSalePrice !== null
      ? Number(input.packSalePrice)
      : Number(input.salePrice);

  if (!Number.isFinite(packPurchasePrice) || packPurchasePrice < 0) {
    throw new BadRequestError(
      `Le prix d'achat par ${getUnitLabel(unitType)} doit être ≥ 0.`,
    );
  }
  if (!Number.isFinite(packSalePrice) || packSalePrice <= 0) {
    throw new BadRequestError(
      `Le prix de vente par ${getUnitLabel(unitType)} doit être > 0.`,
    );
  }
  if (packSalePrice < packPurchasePrice) {
    throw new BadRequestError(
      `Le prix de vente par ${getUnitLabel(unitType)} ne peut pas être inférieur au prix d'achat.`,
    );
  }

  const piecePurchasePrice = packPurchasePrice / unitsPerPack;

  // Prix de vente à la pièce : optionnel ; si non saisi, dérivé du prix du conditionnement
  const hasExplicitPieceSale =
    input.salePrice !== undefined &&
    input.salePrice !== null &&
    Number(input.salePrice) > 0 &&
    input.packSalePrice !== undefined &&
    input.packSalePrice !== null;

  const pieceSalePrice = hasExplicitPieceSale
    ? Number(input.salePrice)
    : Math.max(1, Math.round(packSalePrice / unitsPerPack));

  if (pieceSalePrice < piecePurchasePrice) {
    throw new BadRequestError(
      "Le prix de vente à la pièce ne peut pas être inférieur au prix de revient à la pièce.",
    );
  }

  return {
    purchasePrice: piecePurchasePrice,
    salePrice: pieceSalePrice,
    packPurchasePrice,
    packSalePrice,
    tierBasePurchase: packPurchasePrice,
    tierBaseSale: packSalePrice,
  };
}

export type PricedProduct = {
  unitType: PackagingUnit;
  unitsPerPack: number;
  salePrice: number;
  packSalePrice?: number | null;
  semiWholesalePrice?: number | null;
  semiWholesaleMinQty?: number | null;
  wholesalePrice?: number | null;
  wholesaleMinQty?: number | null;
};

/**
 * Calcule le prix unitaire suggéré et le nombre de pièces déstockées pour une unité vendue donnée.
 * - Vente dans l'unité principale du produit : les paliers Demi-gros / Gros s'appliquent.
 * - Vente à la pièce d'un produit en Douzaine/Carton : prix détail à la pièce (`salePrice`).
 */
export function computePriceForUnit(
  product: PricedProduct,
  quantity: number,
  requestedUnit?: PackagingUnit,
): {
  price: number;
  tier: PriceTier;
  soldUnit: PackagingUnit;
  piecesCount: number;
} {
  const soldUnit: PackagingUnit = requestedUnit || product.unitType || "PIECE";

  if (soldUnit !== "PIECE" && soldUnit !== product.unitType) {
    throw new BadRequestError(
      `Ce produit ne peut pas être vendu en ${getUnitLabel(soldUnit)}.`,
    );
  }

  const multiplier = soldUnit === "PIECE" ? 1 : Math.max(1, product.unitsPerPack);
  const piecesCount = quantity * multiplier;

  // Vente à la pièce d'un produit conditionné (DOZEN / CARTON)
  if (soldUnit === "PIECE" && product.unitType !== "PIECE") {
    return {
      price: product.salePrice,
      tier: "detail",
      soldUnit: "PIECE",
      piecesCount,
    };
  }

  // Vente dans l'unité principale du produit : paliers Gros > Demi-gros > Détail
  if (
    product.wholesalePrice &&
    product.wholesaleMinQty &&
    quantity >= product.wholesaleMinQty
  ) {
    return {
      price: product.wholesalePrice,
      tier: "wholesale",
      soldUnit,
      piecesCount,
    };
  }

  if (
    product.semiWholesalePrice &&
    product.semiWholesaleMinQty &&
    quantity >= product.semiWholesaleMinQty
  ) {
    return {
      price: product.semiWholesalePrice,
      tier: "semiWholesale",
      soldUnit,
      piecesCount,
    };
  }

  const basePrice =
    soldUnit === "PIECE"
      ? product.salePrice
      : (product.packSalePrice ?? product.salePrice * multiplier);

  return {
    price: basePrice,
    tier: "detail",
    soldUnit,
    piecesCount,
  };
}
