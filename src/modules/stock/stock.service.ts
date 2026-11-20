import type { Prisma } from "../../database/prisma/generated/prisma/client.js";
import { PackagingUnit } from "../../database/prisma/generated/prisma/enums.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../config/prisma.js";
import { getUnitLabel, parsePackagingUnit } from "../../helpers/packaging.js";
import { BadRequestError, NotFoundError } from "../../utils/errors.js";
import { sendNotificationToShop } from "../notifications/notification.service.js";

export type StockEntryTxInput = {
  shopId: number;
  userId: number;
  productId: number;
  productName: string;
  purchasePrice: number; // prix d'achat par pièce
  quantity: number; // quantité saisie dans entryUnit
  entryUnit?: PackagingUnit;
  unitsPerPack?: number;
  note?: string | null;
  supplierId?: number | null;
  unitCost?: number | null; // coût unitaire dans entryUnit
  paidAmount?: number;
  createDebt?: boolean;
};

export const StockService = {
  /**
   * Enregistre une entrée de stock dans une transaction existante.
   * Partagé entre la création de produit (stock initial) et POST /stock/entry.
   *
   * Convertit automatiquement les quantités et coûts en pièces (unité atomique en base)
   * tout en conservant le montant total exact pour les dettes fournisseurs et la caisse.
   */
  async recordEntryInTx(tx: Prisma.TransactionClient, input: StockEntryTxInput) {
    const {
      shopId,
      userId,
      productId,
      productName,
      purchasePrice,
      quantity,
      entryUnit = "PIECE",
      unitsPerPack = 1,
      note,
      supplierId,
      unitCost,
      paidAmount = 0,
      createDebt = false,
    } = input;

    const rawQty = Number(quantity);
    if (!Number.isInteger(rawQty) || rawQty <= 0) {
      throw new BadRequestError("La quantité doit être un entier strictement positif");
    }

    const multiplier = entryUnit === "PIECE" ? 1 : Math.max(1, unitsPerPack);
    const qtyInPieces = rawQty * multiplier;

    const parsedSupplierId = supplierId ? Number(supplierId) : null;
    if (parsedSupplierId) {
      const supplier = await tx.supplier.findFirst({
        where: { id: parsedSupplierId, shopId },
        select: { id: true },
      });
      if (!supplier) {
        throw new NotFoundError("Fournisseur introuvable");
      }
    }

    // Coût par unité saisie (ex: coût d'un carton si entryUnit === 'CARTON')
    const costPerEntryUnit =
      unitCost !== undefined && unitCost !== null && Number(unitCost) > 0
        ? Number(unitCost)
        : purchasePrice > 0
          ? Number(purchasePrice) * multiplier
          : null;

    const totalCost = costPerEntryUnit !== null ? costPerEntryUnit * rawQty : null;
    const unitCostPerPiece =
      totalCost !== null ? totalCost / qtyInPieces : null;
    const paid = Number(paidAmount) || 0;

    if (paid < 0) {
      throw new BadRequestError("L'acompte ne peut pas être négatif");
    }

    if (createDebt) {
      if (!parsedSupplierId) {
        throw new BadRequestError("Un fournisseur est obligatoire pour créer une dette");
      }
      if (!costPerEntryUnit || costPerEntryUnit <= 0) {
        throw new BadRequestError("Le coût unitaire doit être supérieur à zéro");
      }
      if (totalCost !== null && paid > totalCost) {
        throw new BadRequestError(
          "L'acompte ne peut pas dépasser le montant total de l'approvisionnement",
        );
      }
    }

    // 1. Incrément atomique du stock (toujours en pièces)
    const updatedProduct = await tx.product.update({
      where: { id: productId },
      data: { quantity: { increment: qtyInPieces } },
    });

    const unitDesc =
      entryUnit === "PIECE"
        ? `x${rawQty}`
        : `x${rawQty} ${getUnitLabel(entryUnit, rawQty > 1)} (${qtyInPieces} pcs)`;

    const movementNote = note
      ? entryUnit === "PIECE"
        ? note
        : `${note} (${rawQty} ${getUnitLabel(entryUnit, rawQty > 1)})`
      : entryUnit === "PIECE"
        ? null
        : `Entrée ${rawQty} ${getUnitLabel(entryUnit, rawQty > 1)}`;

    // 2. Mouvement de stock (quantité et coût unitaire normalisés à la pièce)
    const movement = await tx.stockMovement.create({
      data: {
        shopId,
        productId,
        userId,
        supplierId: parsedSupplierId,
        type: "ENTRY",
        quantity: qtyInPieces,
        unitCost: unitCostPerPiece,
        note: movementNote,
      },
    });

    // 3. Comptabilité fournisseur + caisse
    let debt: Awaited<ReturnType<typeof tx.supplierDebt.create>> | null = null;
    if (parsedSupplierId && totalCost && totalCost > 0) {
      if (createDebt) {
        const remaining = Math.max(0, totalCost - paid);
        const createdDebt = await tx.supplierDebt.create({
          data: {
            supplierId: parsedSupplierId,
            totalAmount: totalCost,
            paidAmount: paid,
            remaining,
            status: remaining <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID",
            note: note || `Approvisionnement — ${productName} ${unitDesc}`,
          },
        });
        debt = createdDebt;

        if (paid > 0) {
          const cashRegister = await tx.cashRegister.findFirst({
            where: { shopId, status: "OPEN" },
          });
          if (!cashRegister) {
            throw new BadRequestError(
              "La caisse est fermée. Veuillez ouvrir la caisse pour verser un acompte fournisseur.",
              "CASH_CLOSED",
            );
          }

          await tx.supplierPayment.create({
            data: {
              debtId: createdDebt.id,
              amount: paid,
              note: "Acompte à la livraison",
            },
          });

          await tx.cashTransaction.create({
            data: {
              cashRegisterId: cashRegister.id,
              type: "OUT",
              amount: paid,
              label: `Acompte fournisseur — ${productName} ${unitDesc}`,
              reference: String(parsedSupplierId),
            },
          });

          await tx.cashRegister.update({
            where: { id: cashRegister.id },
            data: { totalOut: { increment: paid } },
          });
        }
      } else {
        // Achat fournisseur payé comptant : caisse ouverte obligatoire + traçabilité achats
        const cashRegister = await tx.cashRegister.findFirst({
          where: { shopId, status: "OPEN" },
        });
        if (!cashRegister) {
          throw new BadRequestError(
            "La caisse est fermée. Veuillez ouvrir la caisse pour enregistrer un achat fournisseur comptant.",
            "CASH_CLOSED",
          );
        }

        const createdDebt = await tx.supplierDebt.create({
          data: {
            supplierId: parsedSupplierId,
            totalAmount: totalCost,
            paidAmount: totalCost,
            remaining: 0,
            status: "PAID",
            note: note || `Achat comptant — ${productName} ${unitDesc}`,
          },
        });
        debt = createdDebt;

        await tx.supplierPayment.create({
          data: {
            debtId: createdDebt.id,
            amount: totalCost,
            note: "Paiement comptant à la livraison",
          },
        });

        await tx.cashTransaction.create({
          data: {
            cashRegisterId: cashRegister.id,
            type: "OUT",
            amount: totalCost,
            label: `Achat fournisseur — ${productName} ${unitDesc}`,
            reference: String(parsedSupplierId),
          },
        });

        await tx.cashRegister.update({
          where: { id: cashRegister.id },
          data: { totalOut: { increment: totalCost } },
        });
      }
    }

    return { updatedProduct, movement, debt };
  },

  /**
   * Enregistre une sortie de stock de façon atomique (empêche tout stock négatif en concurrence).
   */
  async recordOut(
    shopId: number,
    userId: number,
    productId: number,
    quantity: number,
    note?: string | null,
    outUnit: PackagingUnit = "PIECE",
    unitsPerPack = 1,
  ) {
    const rawQty = Number(quantity);
    if (!Number.isInteger(rawQty) || rawQty <= 0) {
      throw new BadRequestError("productId et quantity (entier > 0) sont obligatoires");
    }

    const multiplier = outUnit === "PIECE" ? 1 : Math.max(1, unitsPerPack);
    const qtyInPieces = rawQty * multiplier;

    return prisma.$transaction(async (tx) => {
      const updated = await tx.product.updateMany({
        where: {
          id: productId,
          shopId,
          isActive: true,
          quantity: { gte: qtyInPieces },
        },
        data: { quantity: { decrement: qtyInPieces } },
      });

      if (updated.count === 0) {
        const exists = await tx.product.findFirst({
          where: { id: productId, shopId, isActive: true },
          select: { id: true, quantity: true },
        });
        if (!exists) {
          throw new NotFoundError("Produit introuvable");
        }
        throw new BadRequestError(
          `Stock insuffisant (disponible: ${exists.quantity} pièces)`,
        );
      }

      const updatedProduct = await tx.product.findUniqueOrThrow({
        where: { id: productId },
      });

      const movementNote = note
        ? outUnit === "PIECE"
          ? note
          : `${note} (${rawQty} ${getUnitLabel(outUnit, rawQty > 1)})`
        : outUnit === "PIECE"
          ? null
          : `Sortie ${rawQty} ${getUnitLabel(outUnit, rawQty > 1)}`;

      const movement = await tx.stockMovement.create({
        data: {
          shopId,
          productId,
          userId,
          type: "OUT",
          quantity: qtyInPieces,
          note: movementNote,
        },
      });

      return { updatedProduct, movement };
    });
  },

  async addEntry(
    shopId: number,
    userId: number,
    payload: {
      productId?: number | string;
      quantity?: number | string;
      unit?: string;
      note?: string;
      supplierId?: number | string;
      unitCost?: number | string;
      paidAmount?: number | string;
      createDebt?: boolean | string;
    },
  ) {
    const parsedProductId = Number(payload.productId);
    const qty = Number(payload.quantity);
    if (!parsedProductId || !Number.isInteger(qty) || qty <= 0) {
      throw new BadRequestError(
        "productId et quantity (entier > 0) sont obligatoires",
      );
    }

    const product = await prisma.product.findFirst({
      where: { id: parsedProductId, shopId, isActive: true },
    });
    if (!product) {
      throw new NotFoundError("Produit introuvable");
    }

    const entryUnit = payload.unit ? parsePackagingUnit(payload.unit) : "PIECE";
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
        note: payload.note || null,
        supplierId: payload.supplierId ? Number(payload.supplierId) : null,
        unitCost:
          payload.unitCost !== undefined && payload.unitCost !== ""
            ? Number(payload.unitCost)
            : null,
        paidAmount: payload.paidAmount ? Number(payload.paidAmount) : 0,
        createDebt: payload.createDebt === true || payload.createDebt === "true",
      }),
    );

    logger.info(
      `📦 Entrée stock — Produit: ${product.id} — Qté: ${qty} (${entryUnit}) — Shop: ${shopId}${payload.supplierId ? ` — Fournisseur: ${payload.supplierId}` : ""}`,
    );

    return result;
  },

  async addOut(
    shopId: number,
    userId: number,
    payload: {
      productId?: number | string;
      quantity?: number | string;
      unit?: string;
      note?: string;
    },
  ) {
    const parsedProductId = Number(payload.productId);
    const qty = Number(payload.quantity);
    if (!parsedProductId || !Number.isInteger(qty) || qty <= 0) {
      throw new BadRequestError(
        "productId et quantity (entier > 0) sont obligatoires",
      );
    }

    const product = await prisma.product.findFirst({
      where: { id: parsedProductId, shopId, isActive: true },
      select: { id: true, unitType: true, unitsPerPack: true },
    });
    if (!product) {
      throw new NotFoundError("Produit introuvable");
    }

    const outUnit = payload.unit ? parsePackagingUnit(payload.unit) : "PIECE";
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
      payload.note || null,
      outUnit,
      product.unitsPerPack,
    );

    logger.info(
      `📤 Sortie stock — Produit: ${parsedProductId} — Qté: ${qty} — Shop: ${shopId}`,
    );

    if (updatedProduct.quantity === 0) {
      sendNotificationToShop(shopId, "stock_alert", {
        type: "out_of_stock",
        outOfStock: [
          { id: updatedProduct.id, name: updatedProduct.name, quantity: 0 },
        ],
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

    return { updatedProduct, movement };
  },

  async listMovements(
    shopId: number,
    query: { page?: number; limit?: number; productId?: number; type?: string },
  ) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { shopId };
    if (query.productId) where.productId = query.productId;
    if (query.type) where.type = query.type;

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

    return {
      data: movements,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  },
};
