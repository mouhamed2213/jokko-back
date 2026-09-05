import { Response } from "express";
import { prisma } from "../config/prisma.js";
import { AuthRequest } from "../middlewares/auth.middleware.js";
import { logger } from "../config/logger.js";
import { sendNotificationToShop } from "./notification.controller.js";

// ── POST /stock/entry ─────────────────────────────────────────
// Paramètres optionnels :
//   supplierId     : lier à un fournisseur existant
//   unitCost       : coût unitaire (pour calculer la dette)
//   paidAmount     : acompte versé au fournisseur à la livraison
//   createDebt     : true/false — créer une dette fournisseur automatiquement
export const addStockEntry = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const userId = req.user!.userId;
    const {
      productId,
      quantity,
      note,
      supplierId,
      unitCost,
      paidAmount,   // acompte versé au fournisseur
      createDebt,   // boolean — créer une dette fournisseur
    } = req.body;

    if (!productId || !quantity || Number(quantity) <= 0) {
      return res.status(400).json({ message: "productId et quantity > 0 sont obligatoires" });
    }

    const product = await prisma.product.findFirst({
      where: { id: Number(productId), shopId },
    });
    if (!product) return res.status(404).json({ message: "Produit introuvable" });

    // Vérifier le fournisseur si fourni
    if (supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: { id: Number(supplierId), shopId },
      });
      if (!supplier) return res.status(404).json({ message: "Fournisseur introuvable" });
    }

    const qty = Number(quantity);
    const cost = supplierId
      ? Number(unitCost || product.purchasePrice)
      : unitCost
        ? Number(unitCost)
        : null;
    const totalCost = cost ? cost * qty : null;
    const paid = paidAmount ? Number(paidAmount) : 0;
    if (paid < 0) {
      return res.status(400).json({ message: "L'acompte ne peut pas être négatif" });
    }
    if (createDebt && (!cost || cost <= 0)) {
      return res.status(400).json({ message: "Le coût unitaire doit être supérieur à zéro" });
    }
    if (createDebt && totalCost !== null && paid > totalCost) {
      return res.status(400).json({
        message: "L'acompte ne peut pas dépasser le montant total de l'approvisionnement",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Mettre à jour le stock
      const updatedProduct = await tx.product.update({
        where: { id: Number(productId) },
        data: { quantity: { increment: qty } },
      });

      // 2. Créer le mouvement de stock
      const movement = await tx.stockMovement.create({
        data: {
          shopId,
          productId: Number(productId),
          userId,
          supplierId: supplierId ? Number(supplierId) : null,
          type: "ENTRY",
          quantity: qty,
          unitCost: cost,
          note: note || null,
        },
      });

      // 3. Gérer la dette fournisseur si demandé
      let debt;
      if (supplierId && createDebt && totalCost && totalCost > 0) {
        const remaining = totalCost - paid;

        debt = await tx.supplierDebt.create({
          data: {
            supplierId: Number(supplierId),
            totalAmount: totalCost,
            paidAmount: paid,
            remaining: remaining > 0 ? remaining : 0,
            status: remaining <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID",
            note: note || `Approvisionnement — ${product.name} x${qty}`,
          },
        });

        // 4. Enregistrer l'acompte si versé
        if (paid > 0) {
          await tx.supplierPayment.create({
            data: {
              debtId: debt.id,
              amount: paid,
              note: "Acompte à la livraison",
            },
          });

          // 5. Décaissement en caisse si elle est ouverte
          const cashRegister = await tx.cashRegister.findFirst({
            where: { shopId, status: "OPEN" },
          });
          if (cashRegister) {
            await tx.cashTransaction.create({
              data: {
                cashRegisterId: cashRegister.id,
                type: "OUT",
                amount: paid,
                label: `Acompte fournisseur — ${product.name} x${qty}`,
                reference: String(supplierId),
              },
            });
            await tx.cashRegister.update({
              where: { id: cashRegister.id },
              data: { totalOut: { increment: paid } },
            });
          }
        }
      }

      return { updatedProduct, movement, debt };
    });

    logger.info(`📦 Entrée stock — Produit: ${productId} — Qté: ${qty} — Shop: ${shopId}${supplierId ? ` — Fournisseur: ${supplierId}` : ""}`);
    return res.status(201).json({
      message: "Entrée de stock enregistrée",
      product: result.updatedProduct,
      movement: result.movement,
      debt: result.debt,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur entrée de stock", error });
  }
};

// ── POST /stock/out ───────────────────────────────────────────
export const addStockOut = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const userId = req.user!.userId;
    const { productId, quantity, note } = req.body;

    if (!productId || !quantity || Number(quantity) <= 0) {
      return res.status(400).json({ message: "productId et quantity > 0 sont obligatoires" });
    }

    const product = await prisma.product.findFirst({
      where: { id: Number(productId), shopId },
    });
    if (!product) return res.status(404).json({ message: "Produit introuvable" });

    if (product.quantity < Number(quantity)) {
      return res.status(400).json({ message: "Stock insuffisant" });
    }

    const [updatedProduct, movement] = await prisma.$transaction([
      prisma.product.update({
        where: { id: Number(productId) },
        data: { quantity: { decrement: Number(quantity) } },
      }),
      prisma.stockMovement.create({
        data: {
          shopId,
          productId: Number(productId),
          userId,
          type: "OUT",
          quantity: Number(quantity),
          note: note || null,
        },
      }),
    ]);

    logger.info(`📤 Sortie stock — Produit: ${productId} — Qté: ${quantity} — Shop: ${shopId}`);

    // Notifier si stock faible ou rupture
    if (updatedProduct.quantity === 0) {
      sendNotificationToShop(shopId, "stock_alert", {
        type: "out_of_stock",
        outOfStock: [{ id: updatedProduct.id, name: updatedProduct.name, quantity: 0 }],
        lowStock: [],
        total: 1,
      });
    } else if (updatedProduct.quantity <= product.alertThreshold) {
      sendNotificationToShop(shopId, "stock_alert", {
        type: "low_stock",
        lowStock: [{ id: updatedProduct.id, name: updatedProduct.name, quantity: updatedProduct.quantity, alertThreshold: product.alertThreshold }],
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
    return res.status(500).json({ message: "Erreur sortie de stock", error });
  }
};

// ── GET /stock/movements ──────────────────────────────────────
export const getStockMovements = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
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
    return res.status(500).json({ message: "Erreur récupération mouvements", error });
  }
};