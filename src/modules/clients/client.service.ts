import { prisma } from "../../config/prisma.js";
import type { Prisma } from "../../database/prisma/generated/prisma/client.js";
import { PlanChecker } from "../subscriptions/plan-checker.service.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors.js";

export const ClientService = {
  list: async (
    shopId: number,
    query: { search?: string; page?: number; limit?: number; paginated: boolean },
  ) => {
    const search = (query.search || "").trim();
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(50, Math.max(1, query.limit || 10));
    const skip = query.paginated ? (page - 1) * limit : undefined;

    const where: Prisma.ClientWhereInput = {
      shopId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, clients, customerCount] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        ...(query.paginated ? { take: limit } : {}),
      }),
      prisma.client.count({ where: { shopId } }),
    ]);

    const clientIds = clients.map((client) => client.id);
    const salesTotals = clientIds.length
      ? await prisma.sale.groupBy({
          by: ["clientId"],
          where: {
            shopId,
            clientId: { in: clientIds },
            status: { not: "CANCELLED" },
          },
          _sum: { totalAmount: true, paidAmount: true, remaining: true },
        })
      : [];

    const totalsByClient = new Map(
      salesTotals.map((salesTotal) => [
        salesTotal.clientId,
        {
          totalPurchases: salesTotal._sum.totalAmount || 0,
          totalPaid: salesTotal._sum.paidAmount || 0,
          totalRemaining: salesTotal._sum.remaining || 0,
        },
      ]),
    );

    const formatted = clients.map((client) => ({
      ...client,
      ...(totalsByClient.get(client.id) || {
        totalPurchases: 0,
        totalPaid: 0,
        totalRemaining: 0,
      }),
    }));

    return {
      data: formatted,
      customerCount,
      pagination: {
        total,
        page,
        limit: query.paginated ? limit : total,
        totalPages: query.paginated ? Math.ceil(total / limit) : total ? 1 : 0,
      },
    };
  },

  getById: async (
    shopId: number,
    id: number,
    query: { page?: number; limit?: number; status?: string },
  ) => {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(20, Math.max(1, query.limit || 5));
    const status = (query.status || "").trim();

    const client = await prisma.client.findFirst({ where: { id, shopId } });
    if (!client) {
      throw new NotFoundError("Client introuvable");
    }

    const salesWhere = {
      shopId,
      clientId: id,
      ...(status ? { status } : {}),
    };

    const [totalSales, sales, totals] = await Promise.all([
      prisma.sale.count({ where: salesWhere }),
      prisma.sale.findMany({
        where: salesWhere,
        include: { items: { include: { product: true } }, payments: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.sale.aggregate({
        where: { shopId, clientId: id, status: { not: "CANCELLED" } },
        _sum: { totalAmount: true, paidAmount: true, remaining: true },
      }),
    ]);

    return {
      ...client,
      sales,
      totalPurchases: totals._sum.totalAmount || 0,
      totalPaid: totals._sum.paidAmount || 0,
      totalRemaining: totals._sum.remaining || 0,
      salesPagination: {
        total: totalSales,
        page,
        limit,
        totalPages: Math.ceil(totalSales / limit),
      },
    };
  },

  createClient: async (
    shopOwnerId: number,
    shopId: number,
    phone: string,
    email: string,
    name: string,
    address: string,
  ) => {
    if (!name || !phone) {
      throw new BadRequestError("Nom , email et téléphone obligatoires");
    }

    const existing = await prisma.client.findFirst({
      where: {
        shopId,
        OR: [{ phone }, ...(email ? [{ email }] : [])],
      },
    });
    if (existing) {
      throw new BadRequestError(
        "Un client avec ce numéro de téléphone ou cet email existe déjà",
      );
    }

    const shop = await PlanChecker.plan(shopId, shopOwnerId);
    if (!shop) {
      throw new NotFoundError("Boutique introuvable");
    }

    if (shop.limits.customers !== null) {
      const customerCount = await prisma.client.count({ where: { shopId } });
      if (customerCount >= shop.limits.customers) {
        throw new ForbiddenError(
          `Vous avez atteint la limite de ${shop.limits.customers} clients autorisée par votre abonnement.`,
        );
      }
    }

    return prisma.client.create({
      data: {
        shopId,
        name,
        phone,
        email: email || null,
        address: address || null,
      },
    });
  },

  update: async (
    shopId: number,
    id: number,
    payload: { name?: string; phone?: string; email?: string; address?: string },
  ) => {
    const existing = await prisma.client.findFirst({ where: { id, shopId } });
    if (!existing) {
      throw new NotFoundError("Client introuvable");
    }

    if (payload.phone && payload.phone !== existing.phone) {
      const duplicate = await prisma.client.findFirst({
        where: { shopId, phone: payload.phone, NOT: { id } },
      });
      if (duplicate) {
        throw new BadRequestError("Ce téléphone est déjà utilisé");
      }
    }

    return prisma.client.update({
      where: { id },
      data: {
        name: payload.name,
        phone: payload.phone,
        email: payload.email || null,
        address: payload.address || null,
      },
    });
  },

  remove: async (shopId: number, id: number) => {
    const existing = await prisma.client.findFirst({
      where: { id, shopId },
      include: { _count: { select: { sales: true } } },
    });
    if (!existing) {
      throw new NotFoundError("Client introuvable");
    }
    if (existing._count.sales > 0) {
      throw new BadRequestError(
        "Impossible de supprimer un client avec des ventes",
      );
    }

    await prisma.client.delete({ where: { id } });
  },
};
