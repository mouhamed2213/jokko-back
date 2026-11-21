import { prisma } from "../../config/prisma.js";
import {
  normalizePaymentSplits,
  type PaymentSplitInput,
} from "../../helpers/payment-splits.js";
import { SubscriptionService } from "../subscriptions/subscription.service.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors.js";

export const SupplierService = {
  list: async (
    shopId: number,
    query: {
      page?: number;
      limit?: number;
      agingBucket?: string;
      search?: string;
    },
  ) => {
    const page = Math.max(query.page || 1, 1);
    const limit = Math.min(Math.max(query.limit || 10, 1), 100);
    const agingBucket = query.agingBucket;
    const search = (query.search || "").trim();

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
      throw new BadRequestError("Tranche d'ancienneté invalide");
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

    return {
      data: formatted,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  },

  getById: async (shopId: number, id: number, page = 1, limit = 10) => {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);

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
          skip: (safePage - 1) * safeLimit,
          take: safeLimit,
        },
      },
    });
    if (!supplier) {
      throw new NotFoundError("Fournisseur introuvable");
    }

    const movementTotal = await prisma.stockMovement.count({
      where: { supplierId: id, shopId, type: "ENTRY" },
    });

    return {
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
        page: safePage,
        limit: safeLimit,
        total: movementTotal,
        totalPages: Math.ceil(movementTotal / safeLimit),
      },
    };
  },

  getProducts: async (shopId: number, supplierId: number) => {
    if (!supplierId) {
      throw new BadRequestError("supplierId requis");
    }

    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, shopId },
      select: { id: true, name: true },
    });
    if (!supplier) {
      throw new NotFoundError("Fournisseur introuvable");
    }

    const entries = await prisma.stockMovement.findMany({
      where: { shopId, supplierId, type: "ENTRY" },
      select: {
        productId: true,
        quantity: true,
        unitCost: true,
        createdAt: true,
        product: { select: { id: true, name: true, imageUrl: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const byProduct = new Map<
      number,
      {
        productId: number;
        productName: string;
        productImageUrl: string | null;
        lastUnitCost: number | null;
        lastDate: Date;
        totalQuantity: number;
        deliveries: number;
      }
    >();

    for (const entry of entries) {
      if (!entry.product) continue;
      const existing = byProduct.get(entry.productId);
      if (!existing) {
        byProduct.set(entry.productId, {
          productId: entry.productId,
          productName: entry.product.name,
          productImageUrl: entry.product.imageUrl,
          lastUnitCost: entry.unitCost,
          lastDate: entry.createdAt,
          totalQuantity: entry.quantity,
          deliveries: 1,
        });
      } else {
        existing.totalQuantity += entry.quantity;
        existing.deliveries += 1;
      }
    }

    const products = Array.from(byProduct.values()).sort(
      (a, b) => b.lastDate.getTime() - a.lastDate.getTime(),
    );

    return { supplier: { id: supplier.id, name: supplier.name }, products };
  },

  getRanking: async (
    shopId: number,
    sortBy = "purchases",
    page = 1,
    limit = 10,
  ) => {
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

    const total = ranked.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const paged = ranked.slice((page - 1) * limit, page * limit);

    return {
      data: paged,
      pagination: { total, page, limit, totalPages },
    };
  },

  getConsolidated: async (userId: number, ownerId: number) => {
    if (userId !== ownerId) {
      throw new ForbiddenError(
        "La vue consolidée est réservée au propriétaire principal.",
      );
    }

    const ownerships = await prisma.shopOwner.findMany({
      where: { userId: ownerId, shop: { status: "ACTIVE" } },
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

    return { shops, grandTotalDebt, grandTotalSuppliers };
  },

  create: async (
    shopId: number,
    ownerId: number,
    payload: { name?: string; phone?: string; email?: string; address?: string },
  ) => {
    if (!payload.name) {
      throw new BadRequestError("Le nom est obligatoire");
    }

    const subscription = await SubscriptionService.currentSubscription(
      shopId,
      ownerId,
    );
    const supplierLimit = subscription.limits.suppliers;
    const supplierCount = await prisma.supplier.count({ where: { shopId } });

    if (supplierLimit !== null && supplierCount >= supplierLimit) {
      throw new ForbiddenError(
        `Limite de fournisseurs atteinte (${supplierLimit}). Passez au plan supérieur pour en ajouter davantage.`,
      );
    }

    return prisma.supplier.create({
      data: {
        shopId,
        name: payload.name,
        phone: payload.phone || null,
        email: payload.email || null,
        address: payload.address || null,
      },
    });
  },

  getQuota: async (shopId: number, ownerId: number) => {
    const subscription = await SubscriptionService.currentSubscription(
      shopId,
      ownerId,
    );
    const limit = subscription.limits.suppliers;
    const count = await prisma.supplier.count({ where: { shopId } });

    return {
      count,
      limit,
      remaining: limit === null ? null : Math.max(limit - count, 0),
      plan: subscription.plan.code,
    };
  },

  getDebtAging: async (shopId: number) => {
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

    return {
      referenceDate: new Date(now).toISOString(),
      totalRemaining: agingDebts.reduce((sum, debt) => sum + debt.remaining, 0),
      totalDebts: agingDebts.length,
      buckets,
      debts: agingDebts,
    };
  },

  update: async (
    shopId: number,
    id: number,
    payload: { name?: string; phone?: string; email?: string; address?: string },
  ) => {
    const existing = await prisma.supplier.findFirst({ where: { id, shopId } });
    if (!existing) {
      throw new NotFoundError("Fournisseur introuvable");
    }

    return prisma.supplier.update({
      where: { id },
      data: {
        name: payload.name || existing.name,
        phone: payload.phone !== undefined ? payload.phone : existing.phone,
        email: payload.email !== undefined ? payload.email : existing.email,
        address:
          payload.address !== undefined ? payload.address : existing.address,
      },
    });
  },

  remove: async (shopId: number, id: number) => {
    const existing = await prisma.supplier.findFirst({
      where: { id, shopId },
      include: {
        _count: { select: { supplierDebts: true, stockMovements: true } },
      },
    });
    if (!existing) {
      throw new NotFoundError("Fournisseur introuvable");
    }

    if (
      existing._count.supplierDebts > 0 ||
      existing._count.stockMovements > 0
    ) {
      throw new BadRequestError(
        "Impossible de supprimer un fournisseur ayant un historique d'achats, de dettes ou de mouvements de stock.",
      );
    }

    await prisma.supplier.delete({ where: { id } });
  },

  addDebt: async (
    shopId: number,
    supplierId: number,
    payload: {
      totalAmount?: number | string;
      paidAmount?: number | string;
      note?: string;
      paymentMethod?: string;
    },
  ) => {
    const total = Number(payload.totalAmount);
    if (!total || total <= 0) {
      throw new BadRequestError("Montant total invalide");
    }

    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, shopId },
    });
    if (!supplier) {
      throw new NotFoundError("Fournisseur introuvable");
    }

    const paid = payload.paidAmount ? Number(payload.paidAmount) : 0;
    if (paid > total) {
      throw new BadRequestError("L'acompte ne peut pas dépasser le total");
    }

    if (paid > 0) {
      const cashRegister = await prisma.cashRegister.findFirst({
        where: { shopId, status: "OPEN" },
      });
      if (!cashRegister) {
        throw new BadRequestError(
          "La caisse est fermée. Impossible de verser un acompte sans caisse ouverte.",
          "CASH_CLOSED",
        );
      }
    }

    const remaining = total - paid;
    const status = remaining <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID";

    return prisma.$transaction(async (tx) => {
      const newDebt = await tx.supplierDebt.create({
        data: {
          supplierId,
          totalAmount: total,
          paidAmount: paid,
          remaining,
          status,
          note: payload.note || null,
        },
      });

      if (paid > 0) {
        await tx.supplierPayment.create({
          data: {
            debtId: newDebt.id,
            amount: paid,
            note: "Acompte initial",
          },
        });

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
  },

  addPayment: async (
    shopId: number,
    supplierId: number,
    debtId: number,
    payload: {
      amount?: number | string;
      note?: string;
      paymentMethod?: string;
      payments?: PaymentSplitInput[];
    },
  ) => {
    const { splits: paymentSplits, totalPaid: paymentAmount } =
      normalizePaymentSplits({
        payments: payload.payments,
        amount: payload.amount,
        paymentMethod: payload.paymentMethod,
        allowZero: false,
      });

    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, shopId },
    });
    if (!supplier) {
      throw new NotFoundError("Fournisseur introuvable");
    }

    const debt = await prisma.supplierDebt.findUnique({
      where: { id: debtId },
    });
    if (!debt || debt.supplierId !== supplierId) {
      throw new NotFoundError("Dette introuvable");
    }
    if (debt.status === "PAID") {
      throw new BadRequestError("Cette dette est déjà soldée");
    }
    if (paymentAmount > debt.remaining + 0.001) {
      throw new BadRequestError(
        `Le montant dépasse le reste dû (${debt.remaining} FCFA)`,
      );
    }

    const cashRegForPayment = await prisma.cashRegister.findFirst({
      where: { shopId, status: "OPEN" },
    });
    if (!cashRegForPayment) {
      throw new BadRequestError(
        "La caisse est fermée. Veuillez ouvrir la caisse avant de payer un fournisseur.",
        "CASH_CLOSED",
      );
    }

    const newPaid = debt.paidAmount + paymentAmount;
    const newRemaining = Math.max(0, debt.remaining - paymentAmount);
    const newStatus = newRemaining <= 0 ? "PAID" : "PARTIAL";

    const createdPayments = await prisma.$transaction(async (tx) => {
      const results: Awaited<ReturnType<typeof tx.supplierPayment.create>>[] = [];
      for (const split of paymentSplits) {
        const newPayment = await tx.supplierPayment.create({
          data: {
            debtId,
            amount: split.amount,
            note: payload.note || null,
            paymentMethod: split.paymentMethod,
          },
        });
        results.push(newPayment);
      }

      await tx.supplierDebt.update({
        where: { id: debtId },
        data: {
          paidAmount: newPaid,
          remaining: newRemaining,
          status: newStatus,
        },
      });

      const cashRegister = await tx.cashRegister.findFirst({
        where: { shopId, status: "OPEN" },
      });
      if (cashRegister) {
        for (const split of paymentSplits) {
          await tx.cashTransaction.create({
            data: {
              cashRegisterId: cashRegister.id,
              type: "OUT",
              amount: split.amount,
              label: `Paiement fournisseur — ${supplier.name}`,
              reference: String(supplierId),
              paymentMethod: split.paymentMethod,
            },
          });
        }
        await tx.cashRegister.update({
          where: { id: cashRegister.id },
          data: { totalOut: { increment: paymentAmount } },
        });
      }

      return results;
    });

    return {
      payment: createdPayments[0],
      payments: createdPayments,
      debtStatus: newStatus,
      remaining: newRemaining,
    };
  },
};
