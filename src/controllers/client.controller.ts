import { NextFunction, Response } from "express";
import { prisma } from "../config/prisma.js";
import { Prisma } from "../database/prisma/generated/prisma/client.js";
import { AuthRequest } from "../middlewares/auth.middleware.js";
import { ClientService } from "../services/client.service.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../utils/errors.js";

export const getClients = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const search = String(req.query.search || "").trim();
    const paginated = req.query.page !== undefined || req.query.limit !== undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const skip = paginated ? (page - 1) * limit : undefined;
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

    const [total, clients] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        ...(paginated ? { take: limit } : {}),
      }),
    ]);

    const clientIds = clients.map((client) => client.id);
    const salesTotals = clientIds.length
      ? await prisma.sale.groupBy({
          by: ["clientId"],
          where: { shopId, clientId: { in: clientIds } },
          _sum: {
            totalAmount: true,
            paidAmount: true,
            remaining: true,
          },
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

    const customerCount = await prisma.client.count({
      where: { shopId },
    });

    return res.status(200).json({
      data: formatted,
      customerCount,
      pagination: {
        total,
        page,
        limit: paginated ? limit : total,
        totalPages: paginated ? Math.ceil(total / limit) : total ? 1 : 0,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur récupération clients", error });
  }
};

export const getClientById = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 5));
    const status = String(req.query.status || "").trim();
    const salesWhere = {
      shopId,
      clientId: id,
      ...(status ? { status } : {}),
    };

    const client = await prisma.client.findFirst({
      where: { id, shopId },
    });

    if (!client) return res.status(404).json({ message: "Client introuvable" });

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
        where: { shopId, clientId: id },
        _sum: { totalAmount: true, paidAmount: true, remaining: true },
      }),
    ]);

    return res.status(200).json({
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
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur récupération client", error });
  }
};

export const createClient = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user;

    const { name, phone, email, address } = req.body;

    if (!name || !phone) {
      throw new BadRequestError("Nom , email et téléphone obligatoires");
    }

    if(!user){
      throw new ForbiddenError('Token invalide ou  à éxpiré')
    }


    const client =  await ClientService.createClient(user?.ownerId, user.shopId, phone, email, name, address)

    return res.status(201).json({ message: "Client créé avec succès", client });
  } catch (e) {
    next(e);
  }
};

export const updateClient = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);
    const { name, phone, email, address } = req.body;

    const existing = await prisma.client.findFirst({ where: { id, shopId } });
    if (!existing)
      return res.status(404).json({ message: "Client introuvable" });

    if (phone && phone !== existing.phone) {
      const duplicate = await prisma.client.findFirst({
        where: { shopId, phone, NOT: { id } },
      });
      if (duplicate)
        return res
          .status(400)
          .json({ message: "Ce téléphone est déjà utilisé" });
    }

    const client = await prisma.client.update({
      where: { id },
      data: { name, phone, email: email || null, address: address || null },
    });

    return res.status(200).json({ message: "Client modifié", client });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur modification client", error });
  }
};

export const deleteClient = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);

    const existing = await prisma.client.findFirst({
      where: { id, shopId },
      include: { _count: { select: { sales: true } } },
    });

    if (!existing)
      return res.status(404).json({ message: "Client introuvable" });
    if (existing._count.sales > 0) {
      return res
        .status(400)
        .json({ message: "Impossible de supprimer un client avec des ventes" });
    }

    await prisma.client.delete({ where: { id } });
    return res.status(200).json({ message: "Client supprimé" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur suppression client", error });
  }
};
