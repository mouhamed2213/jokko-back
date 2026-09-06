import { NextFunction, Response } from "express";
import { logger } from "../config/logger.js";
import { prisma } from "../config/prisma.js";
import { AuthRequest } from "../middlewares/auth.middleware.js";
import { SaleService } from "../services/sale.service.js";
import { BadRequestError, UnauthorizedError } from "../utils/errors.js";
import { Prisma } from "../database/prisma/generated/prisma/client.js";

// ── Helpers ───────────────────────────────────────────────────
export function getSaleStatus(paid: number, total: number) {
  if (paid >= total) return "PAID";
  if (paid > 0) return "PARTIAL";
  return "UNPAID";
}

export async function generateInvoiceNumber(shopId: number): Promise<string> {
  const year = new Date().getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year + 1, 0, 1);

  const countThisYear = await prisma.sale.count({
    where: {
      shopId,
      invoiceNumber: { not: null },
      createdAt: { gte: startOfYear, lt: endOfYear },
    },
  });

  let attempt = 0;
  while (attempt < 20) {
    const seq = String(countThisYear + 1 + attempt).padStart(5, "0");
    const candidate = `FAC-${year}-${seq}`;
    const existing = await prisma.sale.findFirst({
      where: { invoiceNumber: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    attempt++;
  }

  return `FAC-${year}-${Date.now()}`;
}

// ── Encaissement automatique en caisse ───────────────────────
export async function recordCashIn(
  shopId: number,
  amount: number,
  label: string,
  reference: string,
  paymentMethod = "CASH",
) {
  if (amount <= 0) return;
  const cashRegister = await prisma.cashRegister.findFirst({
    where: { shopId, status: "OPEN" },
  });
  if (!cashRegister) return;
  await prisma.$transaction([
    prisma.cashTransaction.create({
      data: {
        cashRegisterId: cashRegister.id,
        type: "IN",
        amount,
        label,
        reference,
        paymentMethod,
      },
    }),
    prisma.cashRegister.update({
      where: { id: cashRegister.id },
      data: { totalIn: { increment: amount } },
    }),
  ]);
}

// ── Décaissement correctif en caisse ─────────────────────────
async function recordCashOut(
  shopId: number,
  amount: number,
  label: string,
  reference: string,
  paymentMethod = "CASH",
) {
  if (amount <= 0) return;
  const cashRegister = await prisma.cashRegister.findFirst({
    where: { shopId, status: "OPEN" },
  });
  if (!cashRegister) return;
  await prisma.$transaction([
    prisma.cashTransaction.create({
      data: {
        cashRegisterId: cashRegister.id,
        type: "OUT",
        amount,
        label,
        reference,
        paymentMethod,
      },
    }),
    prisma.cashRegister.update({
      where: { id: cashRegister.id },
      data: { totalOut: { increment: amount } },
    }),
  ]);
}

// ── GET /sales ────────────────────────────────────────────────
export const getSales = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const status = req.query.status as string | undefined;
    const clientId = req.query.clientId
      ? Number(req.query.clientId)
      : undefined;
    const search = req.query.search as string | undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.SaleWhereInput = { shopId };
    if (status && ["PAID", "PARTIAL", "UNPAID"].includes(status)) {
      where.status = status;
    }
    if (clientId) where.clientId = clientId;
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: "insensitive" } },
        { customerName: { contains: search, mode: "insensitive" } },
        { client: { name: { contains: search, mode: "insensitive" } } },
        { client: { phone: { contains: search, mode: "insensitive" } } },
        { items: { some: { productName: { contains: search, mode: "insensitive" } } } },
      ];
    }

    const [total, sales] = await Promise.all([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        include: {
          client: true,
          items: { include: { product: true } },
          payments: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const salescount = await prisma.sale.count({
      where: { shopId, createdAt: { gte: startOfMonth } },
    });

    return res.status(200).json({
      data: sales,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      meta: {
        salescount,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur récupération ventes", error });
  }
};

// ── GET /sales/:id ────────────────────────────────────────────
export const getSaleById = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);
    const sale = await prisma.sale.findFirst({
      where: { id, shopId },
      include: {
        client: true,
        items: { include: { product: true } },
        payments: true,
      },
    });
    if (!sale) return res.status(404).json({ message: "Vente introuvable" });
    return res.status(200).json(sale);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur récupération vente", error });
  }
};

// ── POST /sales ───────────────────────────────────────────────
export const createSale = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const shopId = req.user!.shopId;
    const userId = req.user!.userId;

    const user = req.user;

    if (!user) {
      throw new UnauthorizedError("Token invalide ou à éxpiré");
    }

    const { clientId, customerName, paidAmount, note, items, paymentMethod } =
      req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new BadRequestError("Au moins un article est requis");
    }

    if (!clientId && !customerName?.trim()) {
      throw new BadRequestError("Client ou nom du client  pasager requis");
    }

    const productIds = items.map((i: any) => Number(i.productId));
    const sale = await SaleService.createSale(
      user.ownerId,
      user.shopId,
      user.userId,
      clientId,
      customerName,
      paidAmount,
      paymentMethod,
      items,
      note,
      productIds,
    );

    return res
      .status(201)
      .json({ message: "Vente enregistrée avec succès", sale });
  } catch (e) {
    // console.error(error);
    next(e);
  }
};

// ── PUT /sales/:id ────────────────────────────────────────────
export const updateSale = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const shopId = req.user!.shopId;
    const userId = req.user!.userId;
    const saleId = Number(req.params.id);

    const { clientId, customerName, items, note } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new BadRequestError("Au moins un article est requis");
    }

    const sale = await SaleService.updateSale(
      shopId,
      userId,
      saleId,
      clientId,
      customerName,
      items,
      note,
    );

    return res
      .status(200)
      .json({ message: "Facture modifiée avec succès", sale });
  } catch (e) {
    next(e);
  }
};

// ── PATCH /sales/:id/payment ──────────────────────────────────
export const addSalePayment = async (req: AuthRequest, res: Response) => {
  const saleId = Number(req.params.id);
  try {
    const shopId = req.user!.shopId;
    const { amount, note, paymentMethod } = req.body;

    const paymentAmount = Number(amount);
    if (!paymentAmount || paymentAmount <= 0) {
      return res.status(400).json({ message: "Montant invalide" });
    }

    const sale = await prisma.sale.findFirst({ where: { id: saleId, shopId } });
    if (!sale) return res.status(404).json({ message: "Vente introuvable" });
    if (sale.remaining <= 0) {
      return res
        .status(400)
        .json({ message: "Cette vente est déjà totalement soldée" });
    }
    if (paymentAmount > sale.remaining) {
      return res.status(400).json({
        message: `Le montant dépasse le reste à payer (${sale.remaining} FCFA)`,
      });
    }

    const newPaid = sale.paidAmount + paymentAmount;
    const newRemaining = sale.remaining - paymentAmount;
    const newStatus = getSaleStatus(newPaid, sale.totalAmount);
    const method = paymentMethod || "CASH";

    const updatedSale = await prisma.$transaction(async (tx) => {
      await tx.salePayment.create({
        data: {
          saleId,
          amount: paymentAmount,
          note: note || null,
          paymentMethod: method,
        },
      });
      return tx.sale.update({
        where: { id: saleId },
        data: {
          paidAmount: newPaid,
          remaining: newRemaining,
          status: newStatus,
        },
        include: { client: true, items: true, payments: true },
      });
    });

    // ✅ Encaissement en caisse avec le bon mode de paiement
    await recordCashIn(
      shopId,
      paymentAmount,
      `Règlement facture ${sale.invoiceNumber || `#${saleId}`}`,
      sale.invoiceNumber || String(saleId),
      method,
    );

    logger.info(
      `💰 Paiement ajouté — Vente #${saleId} — Montant: ${paymentAmount} FCFA — Shop: ${shopId}`,
    );
    return res
      .status(200)
      .json({ message: "Paiement ajouté avec succès", sale: updatedSale });
  } catch (error) {
    logger.error("Erreur ajout paiement", { saleId, error });
    return res.status(500).json({ message: "Erreur ajout paiement", error });
  }
};

// ── DELETE /sales/:id ─────────────────────────────────────────
export const deleteSale = async (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  try {
    const shopId = req.user!.shopId;

    const sale = await prisma.sale.findFirst({
      where: { id, shopId },
      include: { items: true },
    });
    if (!sale) return res.status(404).json({ message: "Vente introuvable" });

    await prisma.$transaction(async (tx) => {
      for (const item of sale.items) {
        if (item.productId) {
          await tx.product.update({
            where: { id: item.productId },
            data: { quantity: { increment: item.quantity } },
          });
          await tx.stockMovement.create({
            data: {
              shopId,
              productId: item.productId,
              type: "ENTRY",
              quantity: item.quantity,
              note: `Annulation vente ${sale.invoiceNumber}`,
            },
          });
        }
      }
      await tx.sale.delete({ where: { id } });
    });

    if (sale.paidAmount > 0) {
      await recordCashOut(
        shopId,
        sale.paidAmount,
        `Annulation vente ${sale.invoiceNumber}`,
        sale.invoiceNumber || String(id),
      );
    }

    logger.warn(`🗑️ Vente annulée — ID: ${id} — Shop: ${shopId}`);
    return res.status(200).json({ message: "Vente annulée et stock restauré" });
  } catch (error) {
    logger.error("Erreur suppression vente", { id, error });
    return res.status(500).json({ message: "Erreur suppression vente", error });
  }
};