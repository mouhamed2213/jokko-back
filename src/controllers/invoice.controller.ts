import { NextFunction, Response } from "express";
import { prisma } from "../config/prisma.js";
import { AuthRequest } from "../middlewares/auth.middleware.js";
import { getFullStorageUrl } from "../utils/file-upload.js";
import { SaleService } from "../services/sale.service.js";

// ── GET /invoices ─────────────────────────────────────────────
export const getInvoices = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;
    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = { shopId };

    if (status) where.status = status;

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: "insensitive" } },
        { customerName: { contains: search, mode: "insensitive" } },
        { client: { name: { contains: search, mode: "insensitive" } } },
        { client: { phone: { contains: search, mode: "insensitive" } } },
      ];
    }

    const [total, invoices] = await Promise.all([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        include: {
          client: true,
          shop: { select: { phone: true } },
          items: { include: { product: true } },
          payments: { orderBy: { paidAt: "asc" } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    const invoicesWithImages = invoices.map((invoice) => {
      const itemsWithImages = invoice.items.map((item) => {
        const imgUrl = item.product?.imageUrl || item.productImageUrl || null;
        const url = getFullStorageUrl("products", imgUrl);
        return { ...item, productImageUrl: url };
      });
      return { ...invoice, items: itemsWithImages };
    });

    // Stats globales (hors factures annulées)
    const stats = await prisma.sale.aggregate({
      where: { shopId, status: { not: "CANCELLED" } },
      _sum: { totalAmount: true, paidAmount: true, remaining: true },
      _count: true,
    });

    return res.status(200).json({
      data: invoicesWithImages,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      stats: {
        totalInvoices: stats._count,
        totalRevenue: stats._sum.totalAmount || 0,
        totalCollected: stats._sum.paidAmount || 0,
        totalOutstanding: stats._sum.remaining || 0,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur récupération factures" });
  }
};

// ── GET /invoices/:id ─────────────────────────────────────────
export const getInvoiceById = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);

    const invoice = await prisma.sale.findFirst({
      where: { id, shopId },
      include: {
        client: true,
        items: { include: { product: true } },
        payments: { orderBy: { paidAt: "asc" } },
      },
    });

    if (!invoice)
      return res.status(404).json({ message: "Facture introuvable" });
    return res.status(200).json(invoice);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur récupération facture" });
  }
};

// ── PATCH /invoices/:id/payment ───────────────────────────────
export const addInvoicePayment = async (
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

    return res.status(200).json({
      message: "Paiement enregistré sur la facture",
      invoice: updatedSale,
    });
  } catch (error) {
    return next(error);
  }
};
