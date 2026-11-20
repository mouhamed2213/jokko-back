import { prisma } from "../../config/prisma.js";
import { PackagingUnit } from "../../database/prisma/generated/prisma/enums.js";
import {
  computePriceForUnit,
  parsePackagingUnit,
  resolvePackagingPrices,
  resolveUnitsPerPack,
} from "../../helpers/packaging.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors.js";
import {
  cleanPath,
  getFullStorageUrl,
  validateFile,
} from "../../utils/file-upload.js";
import { PlanChecker } from "../../services/plan-checker.service.js";
import { StockService } from "../stock/stock.service.js";
import { UploadService } from "../uploads/upload.service.js";

const parseOptionalNumber = (value: unknown): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
};

export const mapProductToDto = (
  product: any,
  bucketName: string = "products",
) => ({
  ...product,
  imageUrl: getFullStorageUrl(bucketName, product.imageUrl),
});

export function computePrice(
  product: {
    salePrice: number;
    semiWholesalePrice?: number | null;
    semiWholesaleMinQty?: number | null;
    wholesalePrice?: number | null;
    wholesaleMinQty?: number | null;
  },
  quantity: number,
): { price: number; tier: "detail" | "semiWholesale" | "wholesale" } {
  if (
    product.wholesalePrice &&
    product.wholesaleMinQty &&
    quantity >= product.wholesaleMinQty
  ) {
    return { price: product.wholesalePrice, tier: "wholesale" };
  }
  if (
    product.semiWholesalePrice &&
    product.semiWholesaleMinQty &&
    quantity >= product.semiWholesaleMinQty
  ) {
    return { price: product.semiWholesalePrice, tier: "semiWholesale" };
  }
  return { price: product.salePrice, tier: "detail" };
}

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
  unitType?: PackagingUnit;
  unitsPerPack?: number;
  purchasePrice?: number | null;
  salePrice?: number | null;
  packPurchasePrice?: number | null;
  packSalePrice?: number | null;
  quantity?: number; // saisi dans unitType (ex: nb de cartons si CARTON)
  alertThreshold?: number; // saisi dans unitType (converti en pièces en base)
  imageUrl?: string | null;
  semiWholesalePrice?: number | null;
  semiWholesaleMinQty?: number | null;
  wholesalePrice?: number | null;
  wholesaleMinQty?: number | null;
  supplierId?: number;
  unitCost?: number; // coût par unitType
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
      unitType = "PIECE",
      unitsPerPack: rawUnitsPerPack,
      purchasePrice: rawPurchasePrice,
      salePrice: rawSalePrice,
      packPurchasePrice: rawPackPurchasePrice,
      packSalePrice: rawPackSalePrice,
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

    const unitsPerPack = resolveUnitsPerPack(unitType, rawUnitsPerPack);

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 0) {
      throw new BadRequestError("La quantité initiale doit être un entier supérieur ou égal à 0.");
    }

    const parsedAlertInUnit = Number.isFinite(alertThreshold)
      ? Number(alertThreshold)
      : 5;
    if (!Number.isInteger(parsedAlertInUnit) || parsedAlertInUnit < 0) {
      throw new BadRequestError("Le seuil d'alerte doit être un entier supérieur ou égal à 0.");
    }
    const alertThresholdInPieces = parsedAlertInUnit * unitsPerPack;

    const prices = resolvePackagingPrices({
      unitType,
      unitsPerPack,
      purchasePrice: rawPurchasePrice,
      salePrice: rawSalePrice,
      packPurchasePrice: rawPackPurchasePrice,
      packSalePrice: rawPackSalePrice,
    });

    // Les paliers Demi-gros / Gros s'appliquent sur l'unité principale du produit
    validateProductPricing({
      purchasePrice: prices.tierBasePurchase,
      salePrice: prices.tierBaseSale,
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
          unitType,
          unitsPerPack,
          quantity: 0,
          purchasePrice: prices.purchasePrice,
          salePrice: prices.salePrice,
          packPurchasePrice: prices.packPurchasePrice,
          packSalePrice: prices.packSalePrice,
          alertThreshold: alertThresholdInPieces,
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
          entryUnit: unitType,
          unitsPerPack,
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

  async list(
    shopId: number,
    query: { search?: string; categoryId?: number; page?: number; limit?: number },
  ) {
    const search = (query.search || "").trim();
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(500, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { shopId, isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { reference: { contains: search, mode: "insensitive" } },
      ];
    }
    if (query.categoryId) where.categoryId = query.categoryId;

    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: { category: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: products.map((product) => mapProductToDto(product, "products")),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      totalProducts: total,
    };
  },

  async getById(shopId: number, id: number) {
    const product = await prisma.product.findFirst({
      where: { id, shopId },
      include: { category: true },
    });
    if (!product) {
      throw new NotFoundError("Produit introuvable");
    }
    return mapProductToDto(product, "products");
  },

  async createFromRequest(
    shopOwnerId: number,
    shopId: number,
    userId: number,
    body: Record<string, any>,
    file?: Express.Multer.File,
  ) {
    const {
      name,
      description,
      reference,
      categoryId,
      unitType: rawUnitType,
      unitsPerPack: rawUnitsPerPack,
      purchasePrice,
      salePrice,
      packPurchasePrice,
      packSalePrice,
      quantity,
      alertThreshold,
      imageUrl: directImageUrl,
      semiWholesalePrice,
      semiWholesaleMinQty,
      wholesalePrice,
      wholesaleMinQty,
      supplierId,
      unitCost,
      paidAmount,
      createDebt,
    } = body;

    const unitType = parsePackagingUnit(rawUnitType);
    const hasPiecePrices =
      purchasePrice !== undefined &&
      purchasePrice !== null &&
      purchasePrice !== "" &&
      salePrice !== undefined &&
      salePrice !== null &&
      salePrice !== "";
    const hasPackPrices =
      packPurchasePrice !== undefined &&
      packPurchasePrice !== null &&
      packPurchasePrice !== "" &&
      packSalePrice !== undefined &&
      packSalePrice !== null &&
      packSalePrice !== "";

    if (
      !name?.trim() ||
      (unitType === "PIECE" ? !hasPiecePrices : !hasPackPrices && !hasPiecePrices)
    ) {
      throw new BadRequestError(
        "Nom, prix d'achat et prix de vente sont obligatoires",
      );
    }

    let imageUrl = directImageUrl || null;
    if (file) {
      validateFile(file);
      const filePath = cleanPath(file);
      const uploadResult = await UploadService.uploadFile(
        file,
        filePath,
        "product",
      );
      imageUrl = uploadResult?.path || null;
    }

    const parsedQuantity =
      quantity === undefined || quantity === null || quantity === ""
        ? 0
        : Number(quantity);

    const parsedAlert =
      alertThreshold === undefined ||
      alertThreshold === null ||
      alertThreshold === ""
        ? unitType === "PIECE"
          ? 5
          : 1
        : Number(alertThreshold);

    const product = await ProductService.createProduct({
      shopOwnerId,
      shopId,
      userId,
      name,
      description,
      reference,
      categoryId,
      unitType,
      unitsPerPack:
        rawUnitsPerPack !== undefined && rawUnitsPerPack !== ""
          ? Number(rawUnitsPerPack)
          : undefined,
      purchasePrice: parseOptionalNumber(purchasePrice) ?? null,
      salePrice: parseOptionalNumber(salePrice) ?? null,
      packPurchasePrice: parseOptionalNumber(packPurchasePrice) ?? null,
      packSalePrice: parseOptionalNumber(packSalePrice) ?? null,
      quantity: parsedQuantity,
      alertThreshold: parsedAlert,
      imageUrl,
      semiWholesalePrice: parseOptionalNumber(semiWholesalePrice) ?? null,
      semiWholesaleMinQty: parseOptionalNumber(semiWholesaleMinQty) ?? null,
      wholesalePrice: parseOptionalNumber(wholesalePrice) ?? null,
      wholesaleMinQty: parseOptionalNumber(wholesaleMinQty) ?? null,
      supplierId: supplierId ? Number(supplierId) : undefined,
      unitCost:
        unitCost !== undefined && unitCost !== "" ? Number(unitCost) : undefined,
      paidAmount: Number(paidAmount) || 0,
      createDebt: createDebt === true || createDebt === "true",
    });

    return mapProductToDto(product, "products");
  },

  async update(
    shopId: number,
    id: number,
    body: Record<string, any>,
    file?: Express.Multer.File,
  ) {
    const existing = await prisma.product.findFirst({ where: { id, shopId } });
    if (!existing) {
      throw new NotFoundError("Produit introuvable");
    }

    const {
      name,
      description,
      reference,
      categoryId,
      unitType: rawUnitType,
      unitsPerPack: rawUnitsPerPack,
      purchasePrice,
      salePrice,
      packPurchasePrice,
      packSalePrice,
      alertThreshold,
      imageUrl,
      semiWholesalePrice,
      semiWholesaleMinQty,
      wholesalePrice,
      wholesaleMinQty,
    } = body;

    const nextUnitType =
      rawUnitType !== undefined
        ? parsePackagingUnit(rawUnitType)
        : existing.unitType;
    const nextUnitsPerPack =
      rawUnitType !== undefined || rawUnitsPerPack !== undefined
        ? resolveUnitsPerPack(
            nextUnitType,
            rawUnitsPerPack !== undefined && rawUnitsPerPack !== ""
              ? Number(rawUnitsPerPack)
              : existing.unitsPerPack,
          )
        : existing.unitsPerPack;

    if (
      existing.quantity > 0 &&
      (nextUnitType !== existing.unitType ||
        nextUnitsPerPack !== existing.unitsPerPack)
    ) {
      throw new BadRequestError(
        "Impossible de modifier le conditionnement d'un produit qui a encore du stock.",
      );
    }

    const parsedPackPurchase = parseOptionalNumber(packPurchasePrice);
    const parsedPackSale = parseOptionalNumber(packSalePrice);
    const parsedPurchase = parseOptionalNumber(purchasePrice);
    const parsedSale = parseOptionalNumber(salePrice);

    const prices = resolvePackagingPrices({
      unitType: nextUnitType,
      unitsPerPack: nextUnitsPerPack,
      purchasePrice:
        parsedPurchase !== undefined ? parsedPurchase : existing.purchasePrice,
      salePrice: parsedSale !== undefined ? parsedSale : existing.salePrice,
      packPurchasePrice:
        parsedPackPurchase !== undefined
          ? parsedPackPurchase
          : existing.packPurchasePrice,
      packSalePrice:
        parsedPackSale !== undefined ? parsedPackSale : existing.packSalePrice,
    });

    const parsedSemiPrice = parseOptionalNumber(semiWholesalePrice);
    const parsedSemiQty = parseOptionalNumber(semiWholesaleMinQty);
    const parsedWholesalePrice = parseOptionalNumber(wholesalePrice);
    const parsedWholesaleQty = parseOptionalNumber(wholesaleMinQty);

    const nextSemiPrice =
      parsedSemiPrice !== undefined
        ? parsedSemiPrice
        : existing.semiWholesalePrice;
    const nextSemiQty =
      parsedSemiQty !== undefined
        ? parsedSemiQty
        : existing.semiWholesaleMinQty;
    const nextWholesalePrice =
      parsedWholesalePrice !== undefined
        ? parsedWholesalePrice
        : existing.wholesalePrice;
    const nextWholesaleQty =
      parsedWholesaleQty !== undefined
        ? parsedWholesaleQty
        : existing.wholesaleMinQty;

    validateProductPricing({
      purchasePrice: prices.tierBasePurchase,
      salePrice: prices.tierBaseSale,
      semiWholesalePrice: nextSemiPrice,
      semiWholesaleMinQty: nextSemiQty,
      wholesalePrice: nextWholesalePrice,
      wholesaleMinQty: nextWholesaleQty,
    });

    const nextReference =
      reference !== undefined
        ? String(reference).trim() || null
        : existing.reference;

    await ProductService.assertUniqueReference(shopId, nextReference, id);

    let finalImageUrl = existing.imageUrl;
    if (file) {
      validateFile(file);
      if (existing.imageUrl && !existing.imageUrl.startsWith("http")) {
        await UploadService.deleteFile("products", existing.imageUrl).catch(
          () => undefined,
        );
      }
      const filePath = cleanPath(file);
      const uploadResult = await UploadService.uploadFile(
        file,
        filePath,
        "product",
      );
      finalImageUrl = uploadResult?.path ?? null;
    } else if (imageUrl === "" || imageUrl === null) {
      if (existing.imageUrl && !existing.imageUrl.startsWith("http")) {
        await UploadService.deleteFile("products", existing.imageUrl).catch(
          () => undefined,
        );
      }
      finalImageUrl = null;
    } else if (typeof imageUrl === "string" && imageUrl.trim()) {
      finalImageUrl = imageUrl.trim();
    }

    const nextAlertInUnit =
      alertThreshold !== undefined && alertThreshold !== ""
        ? Number(alertThreshold)
        : null;
    if (
      nextAlertInUnit !== null &&
      (!Number.isInteger(nextAlertInUnit) || nextAlertInUnit < 0)
    ) {
      throw new BadRequestError(
        "Le seuil d'alerte doit être un entier supérieur ou égal à 0.",
      );
    }
    const nextAlertInPieces =
      nextAlertInUnit !== null
        ? nextAlertInUnit * nextUnitsPerPack
        : existing.alertThreshold;

    const updated = await prisma.product.update({
      where: { id },
      data: {
        name:
          name !== undefined
            ? String(name).trim() || existing.name
            : existing.name,
        description:
          description !== undefined
            ? String(description).trim() || null
            : existing.description,
        reference: nextReference,
        categoryId:
          categoryId !== undefined
            ? categoryId
              ? Number(categoryId)
              : null
            : existing.categoryId,
        unitType: nextUnitType,
        unitsPerPack: nextUnitsPerPack,
        purchasePrice: prices.purchasePrice,
        salePrice: prices.salePrice,
        packPurchasePrice: prices.packPurchasePrice,
        packSalePrice: prices.packSalePrice,
        alertThreshold: nextAlertInPieces,
        imageUrl: finalImageUrl,
        semiWholesalePrice: nextSemiPrice,
        semiWholesaleMinQty: nextSemiQty,
        wholesalePrice: nextWholesalePrice,
        wholesaleMinQty: nextWholesaleQty,
      },
      include: { category: true },
    });

    return mapProductToDto(updated, "products");
  },

  async remove(shopId: number, id: number) {
    const existing = await prisma.product.findFirst({ where: { id, shopId } });
    if (!existing) {
      throw new NotFoundError("Produit introuvable");
    }
    await prisma.product.update({ where: { id }, data: { isActive: false } });
  },

  async getLowStock(shopId: number) {
    const products = await prisma.product.findMany({
      where: { shopId, isActive: true, quantity: { gt: 0 } },
      include: { category: true },
    });
    return products
      .filter((p) => p.quantity <= p.alertThreshold)
      .map((p) => mapProductToDto(p, "products"));
  },

  async getOutOfStock(shopId: number) {
    const products = await prisma.product.findMany({
      where: { shopId, isActive: true, quantity: 0 },
      include: { category: true },
      orderBy: { updatedAt: "desc" },
    });
    return products.map((p) => mapProductToDto(p, "products"));
  },

  async getSuggestedPrice(
    shopId: number,
    id: number,
    quantity: number,
    unit?: string,
  ) {
    const requestedUnit = unit ? parsePackagingUnit(unit) : undefined;
    const product = await prisma.product.findFirst({
      where: { id, shopId },
      select: {
        unitType: true,
        unitsPerPack: true,
        salePrice: true,
        packSalePrice: true,
        semiWholesalePrice: true,
        semiWholesaleMinQty: true,
        wholesalePrice: true,
        wholesaleMinQty: true,
      },
    });
    if (!product) {
      throw new NotFoundError("Produit introuvable");
    }

    const suggested = computePriceForUnit(product, quantity, requestedUnit);
    const baseDetailPrice =
      suggested.soldUnit === "PIECE"
        ? product.salePrice
        : (product.packSalePrice ?? product.salePrice * product.unitsPerPack);

    return {
      quantity,
      soldUnit: suggested.soldUnit,
      piecesCount: suggested.piecesCount,
      suggestedPrice: suggested.price,
      tier: suggested.tier,
      tiers: {
        detail: { price: baseDetailPrice, label: "Détail" },
        semiWholesale:
          suggested.soldUnit === product.unitType && product.semiWholesalePrice
            ? {
                price: product.semiWholesalePrice,
                minQty: product.semiWholesaleMinQty,
                label: "Demi-gros",
              }
            : null,
        wholesale:
          suggested.soldUnit === product.unitType && product.wholesalePrice
            ? {
                price: product.wholesalePrice,
                minQty: product.wholesaleMinQty,
                label: "Gros",
              }
            : null,
      },
    };
  },
};
