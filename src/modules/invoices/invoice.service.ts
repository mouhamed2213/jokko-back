import { prisma } from "../../config/prisma.js";
import { SaleService } from "../sales/sale.service.js";
import { NotFoundError } from "../../utils/errors.js";
import { getFullStorageUrl } from "../../utils/file-upload.js";

export type ListInvoicesQuery = {
  search?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
};

export const InvoiceService = {
  list: async (shopId: number, query: ListInvoicesQuery) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = { shopId };
    if (query.status) where.status = query.status;

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) {
        const end = new Date(query.dateTo);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    if (query.search) {
      where.OR = [
        { invoiceNumber: { contains: query.search, mode: "insensitive" } },
        { customerName: { contains: query.search, mode: "insensitive" } },
        { client: { name: { contains: query.search, mode: "insensitive" } } },
        { client: { phone: { contains: query.search, mode: "insensitive" } } },
      ];
    }

    const [total, invoices, stats] = await Promise.all([
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
      prisma.sale.aggregate({
        where: { shopId, status: { not: "CANCELLED" } },
        _sum: { totalAmount: true, paidAmount: true, remaining: true },
        _count: true,
      }),
    ]);

    const data = invoices.map((invoice) => ({
      ...invoice,
      items: invoice.items.map((item) => {
        const imgUrl = item.product?.imageUrl || item.productImageUrl || null;
        return {
          ...item,
          productImageUrl: getFullStorageUrl("products", imgUrl),
        };
      }),
    }));

    return {
      data,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      stats: {
        totalInvoices: stats._count,
        totalRevenue: stats._sum.totalAmount || 0,
        totalCollected: stats._sum.paidAmount || 0,
        totalOutstanding: stats._sum.remaining || 0,
      },
    };
  },

  getById: async (shopId: number, id: number) => {
    const invoice = await prisma.sale.findFirst({
      where: { id, shopId },
      include: {
        client: true,
        items: { include: { product: true } },
        payments: { orderBy: { paidAt: "asc" } },
      },
    });
    if (!invoice) {
      throw new NotFoundError("Facture introuvable");
    }
    return invoice;
  },

  addPayment: async (
    shopId: number,
    saleId: number,
    amount: number,
    note?: string,
    paymentMethod = "CASH",
  ) => {
    return SaleService.addPayment(shopId, saleId, amount, note, paymentMethod);
  },
};
