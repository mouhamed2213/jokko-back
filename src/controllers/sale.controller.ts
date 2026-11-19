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
    if (status && ["PAID", "PARTIAL", "UNPAID", "CANCELLED"].includes(status)) {
      where.status = status;
    }
    if (clientId) where.clientId = clientId;
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: "insensitive" } },
        { customerName: { contains: search, mode: "insensitive" } },
        { client: { name: { contains: search, mode: "insensitive" } } },
        { client: { phone: { contains: search, mode: "insensitive" } } },
        {
          items: {
            some: { productName: { contains: search, mode: "insensitive" } },
          },
        },
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
      where: {
        shopId,
        status: { not: "CANCELLED" },
        createdAt: { gte: startOfMonth },
      },
    });

    return res.status(200).json({
      data: sales,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      meta: {
        salescount,
      },
    });
  } catch (error) {
    logger.error("Erreur récupération ventes", { error });
    return res.status(500).json({ message: "Erreur récupération ventes" });
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
    logger.error("Erreur récupération vente", { error });
    return res.status(500).json({ message: "Erreur récupération vente" });
  }
};

// ── POST /sales ───────────────────────────────────────────────
export const createSale = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user;
    if (!user) {
      throw new UnauthorizedError("Token invalide ou expiré");
    }

    const { clientId, customerName, paidAmount, note, items, paymentMethod } =
      req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new BadRequestError("Au moins un article est requis");
    }

    if (!clientId && !customerName?.trim()) {
      throw new BadRequestError("Client ou nom du client passager requis");
    }

    const sale = await SaleService.createSale(
      user.ownerId,
      user.shopId,
      user.userId,
      user.role,
      clientId,
      customerName,
      paidAmount,
      paymentMethod,
      items,
      note,
    );

    return res
      .status(201)
      .json({ message: "Vente enregistrée avec succès", sale });
  } catch (e) {
    return next(e);
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
    return next(e);
  }
};

// ── PATCH /sales/:id/payment ──────────────────────────────────
export const addSalePayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const shopId = req.user!.shopId;
    const saleId = Number(req.params.id);
    const { amount, note, paymentMethod } = req.body;

    const updatedSale = await SaleService.addPayment(
      shopId,
      saleId,
      Number(amount),
      note,
      paymentMethod || "CASH",
    );

    return res
      .status(200)
      .json({ message: "Paiement ajouté avec succès", sale: updatedSale });
  } catch (error) {
    return next(error);
  }
};

// ── DELETE /sales/:id (Annulation sans suppression) ───────────
export const deleteSale = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const shopId = req.user!.shopId;
    const userId = req.user!.userId;
    const id = Number(req.params.id);

    const cancelled = await SaleService.cancelSale(shopId, userId, id);

    return res.status(200).json({
      message: "Vente annulée et stock restauré",
      sale: cancelled,
    });
  } catch (error) {
    return next(error);
  }
};
