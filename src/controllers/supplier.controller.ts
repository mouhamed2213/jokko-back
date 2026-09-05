import { NextFunction, Response } from "express";
import { prisma } from "../config/prisma.js";
import { AuthRequest } from "../middlewares/auth.middleware.js";
import { BadRequestError, ForbiddenError } from "../utils/errors.js";
import { SubscriptionService } from "../services/subscription.service.js";

const getSupplierPlan = async (req: AuthRequest) => {
  const subscription = await SubscriptionService.currentSubscription(
    req.user!.shopId,
    req.user!.ownerId,
  );
  return subscription.plan.code;
};

// ── GET /suppliers ────────────────────────────────────────────
export const getSuppliers = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const suppliers = await prisma.supplier.findMany({
      where: { shopId },
      include: {
        supplierDebts: {
          include: { payments: true },
          orderBy: { createdAt: "desc" },
        },
        _count: { select: { stockMovements: true } },
      },
      orderBy: { name: "asc" },
    });

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

    return res.status(200).json(formatted);
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

    const supplier = await prisma.supplier.findFirst({
      where: { id, shopId },
      include: {
        supplierDebts: {
          include: { payments: true },
          orderBy: { createdAt: "desc" },
        },
        stockMovements: {
          include: { product: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });

    if (!supplier)
      return res.status(404).json({ message: "Fournisseur introuvable" });

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
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur récupération fournisseur", error });
  }
};

// ── POST /suppliers ───────────────────────────────────────────
export const createSupplier = async (req: AuthRequest, res: Response, next : NextFunction) => {
  try {
    const { name, phone, email, address } = req.body;
    const shopId = req.user!.shopId;
    const shopPlan = await getSupplierPlan(req);

    if (!name) {
      throw new BadRequestError("Le nom est obligatoire");
    }

    const supplierLimit =
      shopPlan === "FREE" ? 2 : shopPlan === "BASIC" ? 5 : null;
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
    const plan = await getSupplierPlan(req);
    const limit = plan === "FREE" ? 2 : plan === "BASIC" ? 5 : null;
    const count = await prisma.supplier.count({ where: { shopId } });

    return res.status(200).json({
      count,
      limit,
      remaining: limit === null ? null : Math.max(limit - count, 0),
      plan,
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
