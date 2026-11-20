import bcrypt from "bcrypt";
import { logger } from "../../config/logger.js";
import { prisma } from "../../config/prisma.js";
import { PlanChecker } from "../subscriptions/plan-checker.service.js";
import {
  AppError,
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../utils/errors.js";
import { AccountAuthService } from "../email/account-auth.service.js";

export type Role = "EMPLOYEE" | "ADMIN";

export const UserService = {
  list: async (shopId: number) => {
    return prisma.user.findMany({
      where: { shopId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  },

  createUser: async (
    shopOwnerId: number,
    shopId: number,
    name: string,
    email: string,
    rawPassword: string,
    role: Role,
  ) => {
    if (!name || !email || !rawPassword) {
      throw new BadRequestError("Nom, email et mot de passe obligatoires");
    }

    const shopPlan = await PlanChecker.plan(shopId, shopOwnerId);
    const userCount = await prisma.user.count({ where: { shopId } });

    if (
      shopPlan.limits.users !== null &&
      shopPlan.limits.users !== undefined &&
      userCount >= shopPlan.limits.users
    ) {
      throw new AppError(
        `Vous avez atteint la limite de ${shopPlan.limits.users} utilisateur(s) autorisée par votre abonnement.`,
        403,
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictError("Cet email est déjà utilisé");
    }

    const hashedPassword = await bcrypt.hash(rawPassword, 10);
    const user = await prisma.user.create({
      data: {
        shopId,
        name,
        email,
        password: hashedPassword,
        role: role === "ADMIN" ? "ADMIN" : "EMPLOYEE",
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    try {
      await AccountAuthService.requestEmailVerification("USER", user.id);
    } catch (emailError) {
      logger.error("Compte créé, mais email de vérification non envoyé", {
        userId: user.id,
        error:
          emailError instanceof Error ? emailError.message : "Erreur inconnue",
      });
    }

    return user;
  },

  update: async (
    shopId: number,
    currentUserId: number,
    id: number,
    payload: {
      name?: string;
      role?: string;
      isActive?: unknown;
      password?: string;
    },
  ) => {
    const existing = await prisma.user.findFirst({ where: { id, shopId } });
    if (!existing) {
      throw new NotFoundError("Utilisateur introuvable");
    }

    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { currentShop: true },
    });
    if (
      shop?.currentShop === "SECONDARY" &&
      existing.role === "ADMIN" &&
      payload.role &&
      payload.role !== "ADMIN"
    ) {
      throw new ConflictError(
        "Le rôle du responsable principal de cette boutique ne peut pas être rétrogradé.",
      );
    }

    const data: any = {};
    if (payload.name) data.name = payload.name;
    if (payload.role) {
      data.role = payload.role === "ADMIN" ? "ADMIN" : "EMPLOYEE";
    }
    if (payload.isActive !== undefined) {
      if (typeof payload.isActive !== "boolean") {
        throw new BadRequestError("Le statut doit être un booléen");
      }
      if (id === currentUserId && payload.isActive === false) {
        throw new BadRequestError(
          "Vous ne pouvez pas désactiver votre propre compte",
        );
      }
      data.isActive = payload.isActive;
    }
    if (payload.password) {
      data.password = await bcrypt.hash(payload.password, 10);
    }

    return prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
  },

  remove: async (shopId: number, currentUserId: number, id: number) => {
    if (id === currentUserId) {
      throw new BadRequestError(
        "Vous ne pouvez pas supprimer votre propre compte",
      );
    }

    const existing = await prisma.user.findFirst({
      where: { id, shopId },
      include: {
        _count: {
          select: {
            ownedShops: true,
            sales: true,
            cashRegisters: true,
            stockMovements: true,
          },
        },
      },
    });
    if (!existing) {
      throw new NotFoundError("Utilisateur introuvable");
    }

    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { currentShop: true },
    });
    if (shop?.currentShop === "SECONDARY" && existing.role === "ADMIN") {
      throw new ConflictError(
        "Le responsable d'une boutique secondaire doit être désactivé, pas supprimé.",
      );
    }
    if (
      existing._count.ownedShops > 0 ||
      existing._count.sales > 0 ||
      existing._count.cashRegisters > 0 ||
      existing._count.stockMovements > 0
    ) {
      throw new ConflictError(
        "Impossible de supprimer un utilisateur lié à des ventes, caisses, mouvements ou boutiques. Désactivez plutôt son compte.",
      );
    }

    await prisma.user.delete({ where: { id } });
  },

  findUser: async (email: string) => {
    return prisma.user.findUnique({ where: { email } });
  },
};
