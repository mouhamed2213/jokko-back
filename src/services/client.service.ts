import { prisma } from "../config/prisma.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../utils/errors.js";
import { PlanChecker } from "./plan-checker.service.js";

export const ClientService = {
  createClient: async (
    shopOwnerId: number,
    shopId: number,
    phone: string,
    email: string,
    name: string,
    address: string,
  ) => {
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

    const shop = await PlanChecker.plan(shopId , shopOwnerId);

    if (!shop) {
      throw new NotFoundError("Boutique introuvable");
    }

    if (shop.limits.customers !== null) {
      const customerCount = await prisma.client.count({
        where: { shopId },
      });

      if (customerCount >= shop.limits.customers) {
        throw new ForbiddenError(
          `Vous avez atteint la limite de ${shop.limits.customers} clients autorisée par votre abonnement.`,
        );
      }
    }

    const customer = await prisma.client.create({
      data: {
        shopId,
        name,
        phone,
        email: email || null,
        address: address || null,
      },
    });

    return customer;
  },
};
