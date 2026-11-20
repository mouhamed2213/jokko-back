import { NextFunction, Response } from "express";
import { prisma } from "../config/prisma.js";
import { AuthRequest } from "../middlewares/auth.middleware.js";
import {
  ProductService,
  validateProductPricing,
} from "./../services/product.service.js";
import { UploadService } from "../modules/uploads/upload.service.js";
import {
  cleanPath,
  getFullStorageUrl,
  validateFile,
} from "../utils/file-upload.js";
import {
  computePriceForUnit,
  parsePackagingUnit,
  resolvePackagingPrices,
  resolveUnitsPerPack,
} from "../helpers/packaging.js";
import { BadRequestError, NotFoundError } from "../utils/errors.js";

const parseOptionalNumber = (value: unknown): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
};

export const mapProductToDto = (
  product: any,
  bucketName: string = "products",
) => {
  return {
    ...product,
    imageUrl: getFullStorageUrl(bucketName, product.imageUrl),
  };
};

export const getProducts = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const categoryId = req.query.categoryId
      ? Number(req.query.categoryId)
      : undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = { shopId, isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { reference: { contains: search, mode: "insensitive" } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;

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

    const formattedProducts = products.map((product) =>
      mapProductToDto(product, "products"),
    );

    return res.status(200).json({
      data: formattedProducts,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      totalProducts: total,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur récupération produits" });
  }
};

export const getProductById = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);

    const product = await prisma.product.findFirst({
      where: { id, shopId },
      include: { category: true },
    });

    if (!product)
      return res.status(404).json({ message: "Produit introuvable" });

    return res.status(200).json(mapProductToDto(product, "products"));
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur récupération produit" });
  }
};

export const createProduct = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const shopId = req.user!.shopId;
    const shopOwnerId = req.user!.ownerId;
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
    } = req.body;

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

    if (!name?.trim() || (unitType === "PIECE" ? !hasPiecePrices : !hasPackPrices && !hasPiecePrices)) {
      throw new BadRequestError(
        "Nom, prix d'achat et prix de vente sont obligatoires",
      );
    }

    let imageUrl = directImageUrl || null;

    if (req.file) {
      validateFile(req.file);
      const filePath = cleanPath(req.file);
      const uploadResult = await UploadService.uploadFile(
        req.file,
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
      userId: req.user!.userId,
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

    return res.status(201).json({
      message: "Produit créé avec succès",
      product: mapProductToDto(product, "products"),
    });
  } catch (e) {
    return next(e);
  }
};

export const updateProduct = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);

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
    } = req.body;

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

    // Empêcher le changement de conditionnement si du stock existe déjà (intégrité valorisation)
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

    if (req.file) {
      validateFile(req.file);
      if (existing.imageUrl && !existing.imageUrl.startsWith("http")) {
        await UploadService.deleteFile("products", existing.imageUrl).catch(
          () => undefined,
        );
      }
      const filePath = cleanPath(req.file);
      const uploadResult = await UploadService.uploadFile(
        req.file,
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
      throw new BadRequestError("Le seuil d'alerte doit être un entier supérieur ou égal à 0.");
    }
    const nextAlertInPieces =
      nextAlertInUnit !== null
        ? nextAlertInUnit * nextUnitsPerPack
        : existing.alertThreshold;

    // La quantité n'est volontairement pas modifiable ici : elle passe par /stock/entry ou /stock/out.
    const updated = await prisma.product.update({
      where: { id },
      data: {
        name: name !== undefined ? String(name).trim() || existing.name : existing.name,
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

    return res.status(200).json({
      message: "Produit modifié avec succès",
      product: mapProductToDto(updated, "products"),
    });
  } catch (error) {
    return next(error);
  }
};

export const deleteProduct = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);

    const existing = await prisma.product.findFirst({ where: { id, shopId } });
    if (!existing)
      return res.status(404).json({ message: "Produit introuvable" });

    // Soft delete pour préserver l'historique
    await prisma.product.update({ where: { id }, data: { isActive: false } });

    return res.status(200).json({ message: "Produit supprimé avec succès" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur suppression produit" });
  }
};

export const getLowStockProducts = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const products = await prisma.product.findMany({
      where: { shopId, isActive: true, quantity: { gt: 0 } },
      include: { category: true },
    });

    const lowStock = products
      .filter((p) => p.quantity <= p.alertThreshold)
      .map((p) => mapProductToDto(p, "products"));
    return res.status(200).json(lowStock);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur produits stock faible" });
  }
};

export const getOutOfStockProducts = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const shopId = req.user!.shopId;
    const products = await prisma.product.findMany({
      where: { shopId, isActive: true, quantity: 0 },
      include: { category: true },
      orderBy: { updatedAt: "desc" },
    });
    return res
      .status(200)
      .json(products.map((p) => mapProductToDto(p, "products")));
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur produits en rupture" });
  }
};

// ── GET /products/:id/price?quantity=X&unit=PIECE|DOZEN|CARTON ────
export const getSuggestedPrice = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);
    const quantity = Number(req.query.quantity) || 1;
    const requestedUnit = req.query.unit
      ? parsePackagingUnit(req.query.unit)
      : undefined;

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

    if (!product)
      return res.status(404).json({ message: "Produit introuvable" });

    const suggested = computePriceForUnit(product, quantity, requestedUnit);
    const baseDetailPrice =
      suggested.soldUnit === "PIECE"
        ? product.salePrice
        : (product.packSalePrice ?? product.salePrice * product.unitsPerPack);

    return res.status(200).json({
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
    });
  } catch (error) {
    return res.status(500).json({ message: "Erreur calcul prix" });
  }
};

// Helper — calcule le prix selon la quantité
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

export const uploadProductImage = (req: AuthRequest, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: "Aucun fichier reçu" });
  }

  return res.status(200).json({
    message: "Image uploadée avec succès",
    filename: file.filename,
  });
};
