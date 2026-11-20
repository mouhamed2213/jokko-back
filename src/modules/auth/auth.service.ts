import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../../config/env-config.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../config/prisma.js";
import { isBlockedStatus } from "../../helpers/shop-status.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/errors.js";

export const AuthService = {
  login: async (email?: string, password?: string) => {
    if (!email || !password) {
      throw new BadRequestError("Email et mot de passe obligatoires");
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        shop: {
          select: {
            status: true,
            name: true,
            subscriptions: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { plan: { select: { code: true } } },
            },
            primaryShop: {
              select: {
                id: true,
                status: true,
                subscriptions: {
                  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                  take: 1,
                  select: { plan: { select: { code: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      logger.warn(
        `❌ Tentative de connexion échouée — ${email} (utilisateur non trouvé)`,
      );
      throw new UnauthorizedError("Email ou mot de passe incorrect");
    }

    const shopOwner = await prisma.shopOwner.findFirst({
      where: { shopId: user.shopId },
    });
    if (!shopOwner) {
      throw new NotFoundError("Propriétaire non retrouvé");
    }

    const billingSubscription = user.shop.primaryShop
      ? user.shop.primaryShop.subscriptions[0]
      : user.shop.subscriptions[0];
    if (!billingSubscription) {
      throw new NotFoundError(
        "Abonnement de la boutique principale introuvable",
      );
    }

    if (!user.isActive) {
      throw new ForbiddenError(
        "Compte désactivé. Contactez votre administrateur.",
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      logger.warn(
        `❌ Tentative de connexion échouée — ${email} (mauvais mot de passe)`,
      );
      throw new UnauthorizedError("Email ou mot de passe incorrect");
    }

    if (
      isBlockedStatus(user.shop.status) ||
      isBlockedStatus(user.shop.primaryShop?.status)
    ) {
      throw new ForbiddenError(
        "Cette boutique est archivée. Contactez le support pour la réactiver.",
        "SHOP_ARCHIVED",
      );
    }

    const token = jwt.sign(
      {
        ownerId: shopOwner.userId,
        userId: user.id,
        shopId: user.shopId,
        planType: billingSubscription.plan.code,
        role: user.role,
        email: user.email,
      },
      env.secret.jwt,
      { expiresIn: "3d" },
    );

    logger.info(
      `✅ Connexion réussie — ${user.email} (${user.role}) — Boutique: ${user.shop.name} — Plan: ${billingSubscription.plan.code}`,
    );

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        plan: billingSubscription.plan.code,
        shopId: user.shopId,
        shopName: user.shop.name,
        emailVerifiedAt: user.emailVerifiedAt,
      },
    };
  },

  loginSuperAdmin: async (email?: string, password?: string) => {
    if (!email || !password) {
      throw new BadRequestError("Email et mot de passe obligatoires");
    }

    const admin = await prisma.superAdmin.findUnique({ where: { email } });
    if (!admin) {
      throw new UnauthorizedError("Identifiants invalides");
    }

    if (!admin.isActive) {
      throw new ForbiddenError(
        "Ce compte Super Admin est désactivé ou n'a pas encore été activé.",
        "SUPER_ADMIN_DISABLED",
      );
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError("Identifiants invalides");
    }

    await prisma.superAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const token = jwt.sign(
      { userId: admin.id, email: admin.email, role: "SUPER_ADMIN" },
      env.secret.jwt,
      { expiresIn: "1d" },
    );

    return {
      token,
      user: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: "SUPER_ADMIN" as const,
        emailVerifiedAt: admin.emailVerifiedAt,
      },
    };
  },
  getMe: async (userId: number, shopId: number) => {
    const targetShop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, primaryShopId: true },
    });

    if (!targetShop) throw new NotFoundError("shop not found");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, shopId: true, isActive: true },
    });

    const hasShopAccess =
      !!user &&
      user.isActive &&
      (user.shopId === shopId ||
        (user.shopId === targetShop.primaryShopId &&
          !!(await prisma.shopOwner.findFirst({
            where: { userId, shopId },
            select: { id: true },
          }))));

    if (!hasShopAccess) throw new NotFoundError("not found");

    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      include: {
        subscriptions: {
          include: {
            plan: {
              include: {
                planFeature: {
                  include: {
                    feature: true,
                  },
                },
              },
            },
          },
        },
        primaryShop: {
          include: {
            subscriptions: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              include: {
                plan: {
                  include: {
                    planFeature: {
                      include: { feature: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!shop) {
      throw new NotFoundError("shop not found");
    }

    // Une boutique secondaire utilise l'abonnement de sa boutique principale.
    // On expose cet abonnement sous la même propriété pour préserver le contrat API.
    const inheritedSubscriptions = shop.primaryShopId
      ? shop.primaryShop?.subscriptions ?? []
      : shop.subscriptions;

    return {
      ...shop,
      subscriptions: inheritedSubscriptions,
      subscriptionInherited: !!shop.primaryShopId,
      billingShopId: shop.primaryShopId ?? shop.id,
    };
  },
};
