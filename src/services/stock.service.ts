import type { Prisma } from "../database/prisma/generated/prisma/client.js";
import { prisma } from "../config/prisma.js";
import { BadRequestError, NotFoundError } from "../utils/errors.js";

export type StockEntryTxInput = {
  shopId: number;
  userId: number;
  productId: number;
  productName: string;
  purchasePrice: number;
  quantity: number;
  note?: string | null;
  supplierId?: number | null;
  unitCost?: number | null;
  paidAmount?: number;
  createDebt?: boolean;
};

export const StockService = {
  /**
   * Enregistre une entrée de stock dans une transaction existante.
   * Partagé entre la création de produit (stock initial) et POST /stock/entry.
   *
   * Règle métier fournisseur :
   * - Avec dette (createDebt = true) : crée une dette fournisseur. Si un acompte est versé,
   *   la caisse doit être ouverte et est débitée dans la même transaction.
   * - Sans dette (createDebt = false) avec fournisseur : interprété comme un achat payé comptant.
   *   La caisse doit être ouverte et est débitée du montant total ; l'achat est comptabilisé
   *   dans les achats du fournisseur (statut PAID, reste dû = 0).
   */
  async recordEntryInTx(tx: Prisma.TransactionClient, input: StockEntryTxInput) {
    const {
      shopId,
      userId,
      productId,
      productName,
      purchasePrice,
      quantity,
      note,
      supplierId,
      unitCost,
      paidAmount = 0,
      createDebt = false,
    } = input;

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new BadRequestError("La quantité doit être un entier strictement positif");
    }

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

    const parsedUnitCost =
      unitCost !== undefined && unitCost !== null && Number(unitCost) > 0
        ? Number(unitCost)
        : purchasePrice > 0
          ? Number(purchasePrice)
          : null;

    const totalCost = parsedUnitCost !== null ? parsedUnitCost * qty : null;
    const paid = Number(paidAmount) || 0;

    if (paid < 0) {
      throw new BadRequestError("L'acompte ne peut pas être négatif");
    }

    if (createDebt) {
      if (!parsedSupplierId) {
        throw new BadRequestError("Un fournisseur est obligatoire pour créer une dette");
      }
      if (!parsedUnitCost || parsedUnitCost <= 0) {
        throw new BadRequestError("Le coût unitaire doit être supérieur à zéro");
      }
      if (totalCost !== null && paid > totalCost) {
        throw new BadRequestError(
          "L'acompte ne peut pas dépasser le montant total de l'approvisionnement",
        );
      }
    }

    // 1. Incrément atomique du stock
    const updatedProduct = await tx.product.update({
      where: { id: productId },
      data: { quantity: { increment: qty } },
    });

    // 2. Mouvement de stock
    const movement = await tx.stockMovement.create({
      data: {
        shopId,
        productId,
        userId,
        supplierId: parsedSupplierId,
        type: "ENTRY",
        quantity: qty,
        unitCost: parsedUnitCost,
        note: note || null,
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
            note: note || `Approvisionnement — ${productName} x${qty}`,
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
              label: `Acompte fournisseur — ${productName} x${qty}`,
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
            note: note || `Achat comptant — ${productName} x${qty}`,
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
            label: `Achat fournisseur — ${productName} x${qty}`,
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
  ) {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new BadRequestError("productId et quantity (entier > 0) sont obligatoires");
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.product.updateMany({
        where: {
          id: productId,
          shopId,
          isActive: true,
          quantity: { gte: qty },
        },
        data: { quantity: { decrement: qty } },
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
          `Stock insuffisant (disponible: ${exists.quantity})`,
        );
      }

      const updatedProduct = await tx.product.findUniqueOrThrow({
        where: { id: productId },
      });

      const movement = await tx.stockMovement.create({
        data: {
          shopId,
          productId,
          userId,
          type: "OUT",
          quantity: qty,
          note: note || null,
        },
      });

      return { updatedProduct, movement };
    });
  },
};
