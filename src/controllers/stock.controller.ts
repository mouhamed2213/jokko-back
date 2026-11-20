import { NextFunction, Response } from "express";
import { prisma } from "../config/prisma.js";
import { AuthRequest } from "../middlewares/auth.middleware.js";
import { logger } from "../config/logger.js";
import { sendNotificationToShop } from "./notification.controller.js";
import { StockService } from "../services/stock.service.js";
import { parsePackagingUnit } from "../helpers/packaging.js";
import { BadRequestError, NotFoundError } from "../utils/errors.js";

// ── POST /stock/entry ─────────────────────────────────────────
export const addStockEntry = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const shopId = req.user!.shopId;
    const userId = req.user!.userId;
    const {
      productId,
      quantity,
      unit,
      note,
      supplierId,
      unitCost,
      paidAmount,
      createDebt,
    } = req.body;

    const parsedProductId = Number(productId);
    const qty = Number(quantity);
    if (!parsedProductId || !Number.isInteger(qty) || qty <= 0) {
      throw new BadRequestError("productId et quantity (entier > 0) sont obligatoires");
    }

    const product = await prisma.product.findFirst({
      where: { id: parsedProductId, shopId, isActive: true },
    });
    if (!product) {
      throw new NotFoundError("Produit introuvable");
    }

    const entryUnit = unit ? parsePackagingUnit(unit) : "PIECE";
    if (entryUnit !== "PIECE" && entryUnit !== product.unitType) {
      throw new BadRequestError(
        "L'unité choisie ne correspond pas au conditionnement de ce produit.",
      );
    }

    const result = await prisma.$transaction((tx) =>
      StockService.recordEntryInTx(tx, {
        shopId,
        userId,
        productId: product.id,
        productName: product.name,
        purchasePrice: product.purchasePrice,
        quantity: qty,
        entryUnit,
        unitsPerPack: product.unitsPerPack,
        note: note || null,
        supplierId: supplierId ? Number(supplierId) : null,
        unitCost: unitCost !== undefined && unitCost !== "" ? Number(unitCost) : null,
        paidAmount: paidAmount ? Number(paidAmount) : 0,
        createDebt: createDebt === true || createDebt === "true",
      }),
    );

    logger.info(
      `📦 Entrée stock — Produit: ${product.id} — Qté: ${qty} (${entryUnit}) — Shop: ${shopId}${supplierId ? ` — Fournisseur: ${supplierId}` : ""}`,
    );

    return res.status(201).json({
      message: "Entrée de stock enregistrée",
      product: result.updatedProduct,
      movement: result.movement,
      debt: result.debt,
    });
  } catch (error) {
    return next(error);
  }
};

// ── POST /stock/out ───────────────────────────────────────────
export const addStockOut = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const shopId = req.user!.shopId;
    const userId = req.user!.userId;
    const { productId, quantity, unit, note } = req.body;

    const parsedProductId = Number(productId);
    const qty = Number(quantity);
    if (!parsedProductId || !Number.isInteger(qty) || qty <= 0) {
      throw new BadRequestError("productId et quantity (entier > 0) sont obligatoires");
    }

    const product = await prisma.product.findFirst({
      where: { id: parsedProductId, shopId, isActive: true },
      select: { id: true, unitType: true, unitsPerPack: true },
    });
    if (!product) {
      throw new NotFoundError("Produit introuvable");
    }

    const outUnit = unit ? parsePackagingUnit(unit) : "PIECE";
    if (outUnit !== "PIECE" && outUnit !== product.unitType) {
      throw new BadRequestError(
        "L'unité choisie ne correspond pas au conditionnement de ce produit.",
      );
    }

    const { updatedProduct, movement } = await StockService.recordOut(
      shopId,
      userId,
      parsedProductId,
      qty,
      note || null,
      outUnit,
      product.unitsPerPack,
    );

    logger.info(`📤 Sortie stock — Produit: ${parsedProductId} — Qté: ${qty} — Shop: ${shopId}`);

    // Notifier si stock faible ou rupture
    if (updatedProduct.quantity === 0) {
      sendNotificationToShop(shopId, "stock_alert", {
        type: "out_of_stock",
        outOfStock: [{ id: updatedProduct.id, name: updatedProduct.name, quantity: 0 }],
        lowStock: [],
        total: 1,
      });
    } else if (updatedProduct.quantity <= updatedProduct.alertThreshold) {
      sendNotificationToShop(shopId, "stock_alert", {
        type: "low_stock",
        lowStock: [
          {
            id: updatedProduct.id,
            name: updatedProduct.name,
            quantity: updatedProduct.quantity,
            alertThreshold: updatedProduct.alertThreshold,
          },
        ],
        outOfStock: [],
        total: 1,
      });
    }

    return res.status(201).json({
      message: "Sortie de stock enregistrée",
      product: updatedProduct,
      movement,
    });
  } catch (error) {
    return next(error);
  }
};

// ── GET /stock/movements ──────────────────────────────────────
export const getStockMovements = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;
    const productId = req.query.productId ? Number(req.query.productId) : undefined;
    const type = req.query.type as string | undefined;

    const where: any = { shopId };
    if (productId) where.productId = productId;
    if (type) where.type = type;

    const [total, movements] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        include: {
          product: true,
          user: { select: { name: true } },
          supplier: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return res.status(200).json({
      data: movements,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    logger.error("Erreur récupération mouvements", { error });
    return res.status(500).json({ message: "Erreur récupération mouvements" });
  }
};
