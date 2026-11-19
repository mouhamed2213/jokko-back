import { prisma } from "../config/prisma.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
} from "../utils/errors.js";
import { PlanChecker } from "./plan-checker.service.js";
import { StockService } from "./stock.service.js";

export type ProductPricingInput = {
  purchasePrice: number;
  salePrice: number;
  semiWholesalePrice?: number | null;
  semiWholesaleMinQty?: number | null;
  wholesalePrice?: number | null;
  wholesaleMinQty?: number | null;
};

/**
 * Valide la cohérence des prix et des paliers tarifaires (création & modification).
 */
export function validateProductPricing(input: ProductPricingInput): void {
  const {
    purchasePrice,
    salePrice,
    semiWholesalePrice,
    semiWholesaleMinQty,
    wholesalePrice,
    wholesaleMinQty,
  } = input;

  if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
    throw new BadRequestError("Le prix d'achat doit être un nombre supérieur ou égal à 0.");
  }
  if (!Number.isFinite(salePrice) || salePrice <= 0) {
    throw new BadRequestError("Le prix de vente doit être strictement supérieur à 0.");
  }
  if (salePrice < purchasePrice) {
    throw new BadRequestError("Le prix de vente ne peut pas être inférieur au prix d'achat.");
  }

  const hasSemiPrice = semiWholesalePrice !== null && semiWholesalePrice !== undefined;
  const hasSemiQty = semiWholesaleMinQty !== null && semiWholesaleMinQty !== undefined;
  if (hasSemiPrice !== hasSemiQty) {
    throw new BadRequestError(
      "Le palier Demi-gros requiert à la fois une quantité minimum et un prix.",
    );
  }
  if (hasSemiPrice && hasSemiQty) {
    if (!Number.isInteger(semiWholesaleMinQty) || semiWholesaleMinQty! < 2) {
      throw new BadRequestError("La quantité minimum Demi-gros doit être un entier ≥ 2.");
    }
    if (!Number.isFinite(semiWholesalePrice) || semiWholesalePrice! <= 0) {
      throw new BadRequestError("Le prix Demi-gros doit être supérieur à 0.");
    }
    if (semiWholesalePrice! >= salePrice) {
      throw new BadRequestError("Le prix Demi-gros doit être inférieur au prix de vente détail.");
    }
    if (semiWholesalePrice! < purchasePrice) {
      throw new BadRequestError("Le prix Demi-gros ne peut pas être inférieur au prix d'achat.");
    }
  }

  const hasWholesalePrice = wholesalePrice !== null && wholesalePrice !== undefined;
  const hasWholesaleQty = wholesaleMinQty !== null && wholesaleMinQty !== undefined;
  if (hasWholesalePrice !== hasWholesaleQty) {
    throw new BadRequestError(
      "Le palier Gros requiert à la fois une quantité minimum et un prix.",
    );
  }
  if (hasWholesalePrice && hasWholesaleQty) {
    if (!Number.isInteger(wholesaleMinQty) || wholesaleMinQty! < 2) {
      throw new BadRequestError("La quantité minimum Gros doit être un entier ≥ 2.");
    }
    if (!Number.isFinite(wholesalePrice) || wholesalePrice! <= 0) {
      throw new BadRequestError("Le prix Gros doit être supérieur à 0.");
    }
    if (wholesalePrice! >= salePrice) {
      throw new BadRequestError("Le prix Gros doit être inférieur au prix de vente détail.");
    }
    if (wholesalePrice! < purchasePrice) {
      throw new BadRequestError("Le prix Gros ne peut pas être inférieur au prix d'achat.");
    }
  }

  if (hasSemiPrice && hasSemiQty && hasWholesalePrice && hasWholesaleQty) {
    if (wholesaleMinQty! <= semiWholesaleMinQty!) {
      throw new BadRequestError(
        "La quantité minimum Gros doit être strictement supérieure à celle du Demi-gros.",
      );
    }
    if (wholesalePrice! >= semiWholesalePrice!) {
      throw new BadRequestError(
        "Le prix Gros doit être strictement inférieur au prix Demi-gros.",
      );
    }
  }
}

export type CreateProductInput = {
  shopOwnerId: number;
  shopId: number;
  userId: number;
  name: string;
  description?: string;
  reference?: string;
  categoryId?: string;
  purchasePrice: number;
  salePrice: number;
  quantity?: number;
  alertThreshold?: number;
  imageUrl?: string | null;
  semiWholesalePrice?: number | null;
  semiWholesaleMinQty?: number | null;
  wholesalePrice?: number | null;
  wholesaleMinQty?: number | null;
  supplierId?: number;
  unitCost?: number;
  paidAmount?: number;
  createDebt?: boolean;
};

export const ProductService = {
  async assertUniqueReference(
    shopId: number,
    reference: string | null | undefined,
    excludeProductId?: number,
  ) {
    const trimmed = reference?.trim();
    if (!trimmed) return;

    const duplicate = await prisma.product.findFirst({
      where: {
        shopId,
        isActive: true,
        reference: { equals: trimmed, mode: "insensitive" },
        ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
      },
      select: { id: true, name: true },
    });

    if (duplicate) {
      throw new ConflictError(
        `La référence "${trimmed}" est déjà utilisée par le produit "${duplicate.name}".`,
      );
    }
  },

  async createProduct(input: CreateProductInput) {
    const {
      shopOwnerId,
      shopId,
      userId,
      name,
      description,
      reference,
      categoryId,
      purchasePrice,
      salePrice,
      quantity = 0,
      alertThreshold = 5,
      imageUrl,
      semiWholesalePrice,
      semiWholesaleMinQty,
      wholesalePrice,
      wholesaleMinQty,
      supplierId,
      unitCost,
      paidAmount = 0,
      createDebt = false,
    } = input;

    const subscription = await PlanChecker.plan(shopId, shopOwnerId);
    if (!subscription) {
      throw new ForbiddenError("Abonnement introuvable");
    }

    // Ne compter que les produits actifs ; null = illimité (plans payants)
    const maxProducts = subscription.limits.products;
    if (maxProducts !== null && maxProducts !== undefined) {
      const currentProducts = await prisma.product.count({
        where: { shopId, isActive: true },
      });

      if (currentProducts >= maxProducts) {
        throw new ForbiddenError(
          `Vous avez atteint la limite de ${maxProducts} produits autorisés par votre abonnement.`,
        );
      }
    }

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 0) {
      throw new BadRequestError("La quantité initiale doit être un entier supérieur ou égal à 0.");
    }

    const parsedAlert = Number.isFinite(alertThreshold) ? Number(alertThreshold) : 5;
    if (!Number.isInteger(parsedAlert) || parsedAlert < 0) {
      throw new BadRequestError("Le seuil d'alerte doit être un entier supérieur ou égal à 0.");
    }

    validateProductPricing({
      purchasePrice,
      salePrice,
      semiWholesalePrice,
      semiWholesaleMinQty,
      wholesalePrice,
      wholesaleMinQty,
    });

    const trimmedRef = reference?.trim() || null;
    await ProductService.assertUniqueReference(shopId, trimmedRef);

    return prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          shopId,
          name: name.trim(),
          description: description?.trim() || null,
          reference: trimmedRef,
          categoryId: categoryId ? Number(categoryId) : null,
          quantity: 0,
          purchasePrice: Number(purchasePrice),
          salePrice: Number(salePrice),
          alertThreshold: parsedAlert,
          imageUrl: imageUrl || null,
          semiWholesalePrice: semiWholesalePrice ?? null,
          semiWholesaleMinQty: semiWholesaleMinQty ?? null,
          wholesalePrice: wholesalePrice ?? null,
          wholesaleMinQty: wholesaleMinQty ?? null,
        },
      });

      if (qty > 0) {
        await StockService.recordEntryInTx(tx, {
          shopId,
          userId,
          productId: product.id,
          productName: product.name,
          purchasePrice: product.purchasePrice,
          quantity: qty,
          note: "Stock initial",
          supplierId: supplierId || null,
          unitCost: unitCost ?? null,
          paidAmount,
          createDebt,
        });
      }

      return tx.product.findUniqueOrThrow({
        where: { id: product.id },
        include: { category: true },
      });
    });
  },
};
