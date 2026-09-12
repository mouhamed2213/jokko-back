import { NextFunction, Response } from "express";
import { prisma } from "../config/prisma.js";
import { AuthRequest } from "../middlewares/auth.middleware.js";
import { BadRequestError, ForbiddenError } from "../utils/errors.js";
import { SubscriptionService } from "../services/subscription.service.js";

const getSupplierSubscription = async (req: AuthRequest) => {
  return SubscriptionService.currentSubscription(
    req.user!.shopId,
    req.user!.ownerId,
  );
};

// ── GET /suppliers ────────────────────────────────────────────
export const getSuppliers = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
    const agingBucket =
      typeof req.query.agingBucket === "string"
        ? req.query.agingBucket
        : undefined;
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const now = Date.now();
    const day = 86_400_000;
    const agingRanges: Record<string, { gte?: Date; lt?: Date }> = {
      "0-30": { gte: new Date(now - 31 * day) },
      "31-60": {
        gte: new Date(now - 61 * day),
        lt: new Date(now - 31 * day),
      },
      "61-90": {
        gte: new Date(now - 91 * day),
        lt: new Date(now - 61 * day),
      },
      "90+": { lt: new Date(now - 91 * day) },
    };
    const agingRange = agingBucket ? agingRanges[agingBucket] : undefined;
    if (agingBucket && !agingRange) {
      return res.status(400).json({ message: "Tranche d'ancienneté invalide" });
    }
    const debtWhere = {
      status: { in: ["UNPAID", "PARTIAL"] },
      ...(agingRange ? { createdAt: agingRange } : {}),
    };
    const supplierWhere = {
      shopId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(agingRange ? { supplierDebts: { some: debtWhere } } : {}),
    };
    const [total, suppliers] = await Promise.all([
      prisma.supplier.count({ where: supplierWhere }),
      prisma.supplier.findMany({
        where: supplierWhere,
        include: {
          supplierDebts: {
            where: agingBucket ? debtWhere : undefined,
            include: { payments: true },
            orderBy: { createdAt: "desc" },
          },
          _count: { select: { stockMovements: true } },
        },
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const formatted = suppliers.map((s) => ({
      ...s,
      totalDebt: s.supplierDebts
        .filter((d) => d.status !== "PAID")
        .reduce((sum, d) => sum + d.remaining, 0),
      totalPaid: s.supplierDebts.reduce((sum, d) => sum + d.paidAmount, 0),
      totalPurchases: s.supplierDebts.reduce(
        (sum, d) => sum + d.totalAmount,
        0,
      ),
      deliveries: s._count.stockMovements,
    }));

    return res.status(200).json({
      data: formatted,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur récupération fournisseurs", error });
  }
};

// ── GET /suppliers/:id ────────────────────────────────────────
export const getSupplierById = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);

    const supplier = await prisma.supplier.findFirst({
      where: { id, shopId },
      include: {
        supplierDebts: {
          include: { payments: true },
          orderBy: { createdAt: "desc" },
        },
        stockMovements: {
          where: { type: "ENTRY" },
          include: { product: true },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        },
      },
    });

    if (!supplier)
      return res.status(404).json({ message: "Fournisseur introuvable" });

    const movementTotal = await prisma.stockMovement.count({
      where: { supplierId: id, shopId, type: "ENTRY" },
    });

    return res.status(200).json({
      ...supplier,
      totalDebt: supplier.supplierDebts
        .filter((d) => d.status !== "PAID")
        .reduce((sum, d) => sum + d.remaining, 0),
      totalPaid: supplier.supplierDebts.reduce(
        (sum, d) => sum + d.paidAmount,
        0,
      ),
      totalPurchases: supplier.supplierDebts.reduce(
        (sum, d) => sum + d.totalAmount,
        0,
      ),
      stockMovementsPagination: {
        page,
        limit,
        total: movementTotal,
        totalPages: Math.ceil(movementTotal / limit),
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur récupération fournisseur", error });
  }
};

// ── GET /suppliers/analytics/price-comparison?productId= ──────
// Compare le coût unitaire pratiqué par chaque fournisseur pour un produit.
export const getSupplierPriceComparison = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const shopId = req.user!.shopId;
    const productId = Number(req.query.productId);

    if (!productId) {
      return res.status(400).json({ message: "productId requis" });
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, shopId },
      select: { id: true, name: true },
    });
    if (!product) {
      return res.status(404).json({ message: "Produit introuvable" });
    }

    const entries = await prisma.stockMovement.findMany({
      where: {
        shopId,
        productId,
        type: "ENTRY",
        supplierId: { not: null },
        unitCost: { not: null },
      },
      select: {
        unitCost: true,
        quantity: true,
        createdAt: true,
        supplierId: true,
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const bySupplier = new Map<
      number,
      {
        supplierId: number;
        supplierName: string;
        lastUnitCost: number;
        lastDate: Date;
        minUnitCost: number;
        maxUnitCost: number;
        avgUnitCost: number;
        totalQuantity: number;
        deliveries: number;
      }
    >();

    for (const entry of entries) {
      if (!entry.supplierId || entry.unitCost === null) continue;
      const cost = entry.unitCost;
      const existing = bySupplier.get(entry.supplierId);
      if (!existing) {
        bySupplier.set(entry.supplierId, {
          supplierId: entry.supplierId,
          supplierName: entry.supplier?.name || "Fournisseur",
          lastUnitCost: cost,
          lastDate: entry.createdAt,
          minUnitCost: cost,
          maxUnitCost: cost,
          avgUnitCost: cost,
          totalQuantity: entry.quantity,
          deliveries: 1,
        });
      } else {
        existing.minUnitCost = Math.min(existing.minUnitCost, cost);
        existing.maxUnitCost = Math.max(existing.maxUnitCost, cost);
        existing.avgUnitCost =
          (existing.avgUnitCost * existing.deliveries + cost) /
          (existing.deliveries + 1);
        existing.totalQuantity += entry.quantity;
        existing.deliveries += 1;
        // entries triés du plus récent au plus ancien : le premier vu est le dernier prix
      }
    }

    const suppliers = Array.from(bySupplier.values()).sort(
      (a, b) => a.lastUnitCost - b.lastUnitCost,
    );

    return res.status(200).json({
      product: { id: product.id, name: product.name },
      suppliers,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Erreur comparaison des prix fournisseurs",
      error,
    });
  }
};

// ── GET /suppliers/analytics/ranking ────────────────────────────
// Classe les fournisseurs par montant acheté, dette due et livraisons.
export const getSupplierRanking = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const sortBy =
      typeof req.query.sortBy === "string" ? req.query.sortBy : "purchases";

    const suppliers = await prisma.supplier.findMany({
      where: { shopId },
      include: {
        supplierDebts: true,
        _count: { select: { stockMovements: true } },
      },
    });

    const ranked = suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      totalPurchases: s.supplierDebts.reduce(
        (sum, d) => sum + d.totalAmount,
        0,
      ),
      totalDebt: s.supplierDebts
        .filter((d) => d.status !== "PAID")
        .reduce((sum, d) => sum + d.remaining, 0),
      deliveries: s._count.stockMovements,
    }));

    const sortKey: "totalDebt" | "deliveries" | "totalPurchases" =
      sortBy === "debt"
        ? "totalDebt"
        : sortBy === "deliveries"
          ? "deliveries"
          : "totalPurchases";

    ranked.sort((a, b) => b[sortKey] - a[sortKey]);

    return res.status(200).json({ data: ranked });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur classement fournisseurs", error });
  }
};

// ── GET /suppliers/consolidated ─────────────────────────────────
// Vue consolidée des fournisseurs/dettes à travers toutes les boutiques
// du même propriétaire (aucune fusion de données, juste une addition
// boutique par boutique — chaque boutique garde sa propre comptabilité).
export const getConsolidatedSuppliers = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const ownerId = req.user!.ownerId;

    const ownerships = await prisma.shopOwner.findMany({
      where: { userId: ownerId },
      select: { shop: { select: { id: true, name: true } } },
    });

    const shops = await Promise.all(
      ownerships.map(async ({ shop }) => {
        const suppliers = await prisma.supplier.findMany({
          where: { shopId: shop.id },
          include: { supplierDebts: true },
        });

        const totalDebt = suppliers.reduce(
          (sum, s) =>
            sum +
            s.supplierDebts
              .filter((d) => d.status !== "PAID")
              .reduce((dSum, d) => dSum + d.remaining, 0),
          0,
        );
        const totalPurchases = suppliers.reduce(
          (sum, s) =>
            sum +
            s.supplierDebts.reduce((dSum, d) => dSum + d.totalAmount, 0),
          0,
        );

        return {
          shopId: shop.id,
          shopName: shop.name,
          supplierCount: suppliers.length,
          totalDebt,
          totalPurchases,
        };
      }),
    );

    const grandTotalDebt = shops.reduce((sum, s) => sum + s.totalDebt, 0);
    const grandTotalSuppliers = shops.reduce(
      (sum, s) => sum + s.supplierCount,
      0,
    );

    return res.status(200).json({ shops, grandTotalDebt, grandTotalSuppliers });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur vue consolidée fournisseurs", error });
  }
};


export const createSupplier = async (req: AuthRequest, res: Response, next : NextFunction) => {
  try {
    const { name, phone, email, address } = req.body;
    const shopId = req.user!.shopId;
    const subscription = await getSupplierSubscription(req);

    if (!name) {
      throw new BadRequestError("Le nom est obligatoire");
    }

    const supplierLimit = subscription.limits.suppliers;
    const supplierCount = await prisma.supplier.count({ where: { shopId } });

    if (supplierLimit !== null && supplierCount >= supplierLimit) {
      throw new ForbiddenError(
        `Limite de fournisseurs atteinte (${supplierLimit}). Passez au plan supérieur pour en ajouter davantage.`,
      );
    }

    const supplier = await prisma.supplier.create({
      data: {
        shopId,
        name,
        phone: phone || null,
        email: email || null,
        address: address || null,
      },
    });

    return res
      .status(201)
      .json({ message: "Fournisseur créé avec succès", supplier });
  } catch (e) {
    next(e)
  }
};

// ── GET /suppliers/quota ───────────────────────────────────────
export const getSupplierQuota = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const subscription = await getSupplierSubscription(req);
    const limit = subscription.limits.suppliers;
    const count = await prisma.supplier.count({ where: { shopId } });

    return res.status(200).json({
      count,
      limit,
      remaining: limit === null ? null : Math.max(limit - count, 0),
      plan: subscription.plan.code,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur récupération quota fournisseurs", error });
  }
};

// ── GET /suppliers/aging ───────────────────────────────────────
export const getSupplierDebtAging = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const debts = await prisma.supplierDebt.findMany({
      where: {
        supplier: { shopId },
        status: { in: ["UNPAID", "PARTIAL"] },
      },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });

    const now = Date.now();
    const buckets = [
      { key: "0-30", label: "0–30 jours", min: 0, max: 30, count: 0, amount: 0 },
      { key: "31-60", label: "31–60 jours", min: 31, max: 60, count: 0, amount: 0 },
      { key: "61-90", label: "61–90 jours", min: 61, max: 90, count: 0, amount: 0 },
      { key: "90+", label: "90+ jours", min: 91, max: Infinity, count: 0, amount: 0 },
    ];

    const agingDebts = debts.map((debt) => {
      const ageDays = Math.max(
        0,
        Math.floor((now - debt.createdAt.getTime()) / 86_400_000),
      );
      const bucket = buckets.find(
        (candidate) => ageDays >= candidate.min && ageDays <= candidate.max,
      )!;
      bucket.count += 1;
      bucket.amount += debt.remaining;

      return {
        id: debt.id,
        supplierId: debt.supplierId,
        supplierName: debt.supplier.name,
        totalAmount: debt.totalAmount,
        remaining: debt.remaining,
        status: debt.status,
        createdAt: debt.createdAt,
        ageDays,
        bucket: bucket.key,
        note: debt.note,
      };
    });

    return res.status(200).json({
      referenceDate: new Date(now).toISOString(),
      totalRemaining: agingDebts.reduce((sum, debt) => sum + debt.remaining, 0),
      totalDebts: agingDebts.length,
      buckets,
      debts: agingDebts,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur rapport ancienneté dettes", error });
  }
};

// ── PUT /suppliers/:id ────────────────────────────────────────
export const updateSupplier = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);
    const { name, phone, email, address } = req.body;

    const existing = await prisma.supplier.findFirst({ where: { id, shopId } });
    if (!existing)
      return res.status(404).json({ message: "Fournisseur introuvable" });

    const updated = await prisma.supplier.update({
      where: { id },
      data: {
        name: name || existing.name,
        phone: phone !== undefined ? phone : existing.phone,
        email: email !== undefined ? email : existing.email,
        address: address !== undefined ? address : existing.address,
      },
    });

    return res
      .status(200)
      .json({ message: "Fournisseur modifié", supplier: updated });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur modification fournisseur", error });
  }
};

// ── DELETE /suppliers/:id ─────────────────────────────────────
export const deleteSupplier = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);

    const existing = await prisma.supplier.findFirst({ where: { id, shopId } });
    if (!existing)
      return res.status(404).json({ message: "Fournisseur introuvable" });

    await prisma.supplier.delete({ where: { id } });
    return res.status(200).json({ message: "Fournisseur supprimé" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur suppression fournisseur", error });
  }
};

// ── POST /suppliers/:id/debts ─────────────────────────────────
// Créer une dette manuellement (sans approvisionnement)
export const addSupplierDebt = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const supplierId = Number(req.params.id);
    const { totalAmount, paidAmount, note } = req.body;

    if (!totalAmount || Number(totalAmount) <= 0) {
      return res.status(400).json({ message: "Montant total invalide" });
    }

    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, shopId },
    });
    if (!supplier)
      return res.status(404).json({ message: "Fournisseur introuvable" });

    const total = Number(totalAmount);
    const paid = paidAmount ? Number(paidAmount) : 0;
    const paymentMethod = req.body.paymentMethod || "CASH";

    if (paid > total) {
      return res
        .status(400)
        .json({ message: "L'acompte ne peut pas dépasser le total" });
    }

    // Si acompte versé, vérifier que la caisse est ouverte
    if (paid > 0) {
      const cashRegister = await prisma.cashRegister.findFirst({
        where: { shopId, status: "OPEN" },
      });
      if (!cashRegister) {
        return res.status(400).json({
          message:
            "La caisse est fermée. Impossible de verser un acompte sans caisse ouverte.",
          code: "CASH_CLOSED",
        });
      }
    }

    const remaining = total - paid;
    const status = remaining <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID";

    const debt = await prisma.$transaction(async (tx) => {
      const newDebt = await tx.supplierDebt.create({
        data: {
          supplierId,
          totalAmount: total,
          paidAmount: paid,
          remaining,
          status,
          note: note || null,
        },
      });

      // Enregistrer l'acompte si versé
      if (paid > 0) {
        await tx.supplierPayment.create({
          data: {
            debtId: newDebt.id,
            amount: paid,
            note: "Acompte initial",
          },
        });

        // Décaissement en caisse si ouverte
        const cashRegister = await tx.cashRegister.findFirst({
          where: { shopId, status: "OPEN" },
        });
        if (cashRegister) {
          await tx.cashTransaction.create({
            data: {
              cashRegisterId: cashRegister.id,
              type: "OUT",
              amount: paid,
              label: `Acompte fournisseur — ${supplier.name}`,
              reference: String(supplierId),
            },
          });
          await tx.cashRegister.update({
            where: { id: cashRegister.id },
            data: { totalOut: { increment: paid } },
          });
        }
      }

      return newDebt;
    });

    return res.status(201).json({ message: "Dette enregistrée", debt });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur ajout dette fournisseur", error });
  }
};

// ── POST /suppliers/:id/debts/:debtId/payments ────────────────
// Enregistrer un paiement (règlement ou acompte) vers un fournisseur
export const addSupplierPayment = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const supplierId = Number(req.params.id);
    const debtId = Number(req.params.debtId);
    const { amount, note } = req.body;

    const paymentAmount = Number(amount);
    if (!paymentAmount || paymentAmount <= 0) {
      return res.status(400).json({ message: "Montant invalide" });
    }

    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, shopId },
    });
    if (!supplier)
      return res.status(404).json({ message: "Fournisseur introuvable" });

    const debt = await prisma.supplierDebt.findUnique({
      where: { id: debtId },
    });
    if (!debt) return res.status(404).json({ message: "Dette introuvable" });
    if (debt.status === "PAID") {
      return res.status(400).json({ message: "Cette dette est déjà soldée" });
    }
    if (paymentAmount > debt.remaining) {
      return res.status(400).json({
        message: `Le montant dépasse le reste dû (${debt.remaining} FCFA)`,
      });
    }

    // ✅ Vérifier que la caisse est ouverte
    const cashRegForPayment = await prisma.cashRegister.findFirst({
      where: { shopId, status: "OPEN" },
    });
    if (!cashRegForPayment) {
      return res.status(400).json({
        message:
          "La caisse est fermée. Veuillez ouvrir la caisse avant de payer un fournisseur.",
        code: "CASH_CLOSED",
      });
    }

    const newPaid = debt.paidAmount + paymentAmount;
    const newRemaining = debt.remaining - paymentAmount;
    const newStatus = newRemaining <= 0 ? "PAID" : "PARTIAL";

    const payment = await prisma.$transaction(async (tx) => {
      const newPayment = await tx.supplierPayment.create({
        data: {
          debtId: debtId,
          amount: paymentAmount,
          note: note || null,
        },
      });

      await tx.supplierDebt.update({
        where: { id: debtId },
        data: {
          paidAmount: newPaid,
          remaining: newRemaining,
          status: newStatus,
        },
      });

      // ✅ Décaissement automatique en caisse si ouverte
      const cashRegister = await tx.cashRegister.findFirst({
        where: { shopId, status: "OPEN" },
      });
      if (cashRegister) {
        await tx.cashTransaction.create({
          data: {
            cashRegisterId: cashRegister.id,
            type: "OUT",
            amount: paymentAmount,
            label: `Paiement fournisseur — ${supplier.name}`,
            reference: String(supplierId),
          },
        });
        await tx.cashRegister.update({
          where: { id: cashRegister.id },
          data: { totalOut: { increment: paymentAmount } },
        });
      }

      return newPayment;
    });

    return res.status(201).json({
      message: "Paiement enregistré",
      payment,
      debtStatus: newStatus,
      remaining: newRemaining,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur paiement fournisseur", error });
  }
};
