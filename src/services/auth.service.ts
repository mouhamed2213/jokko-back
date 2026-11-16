import { prisma } from "../config/prisma.js";
import { NotFoundError } from "../utils/errors.js";

export const AuthService = {
  getMe: async (userId: number, shopId: number) => {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true, primaryShopId: true },
    });

    if (!shop) throw new NotFoundError("shop not found");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, shopId: true, isActive: true },
    });

    const hasShopAccess =
      !!user &&
      user.isActive &&
      (user.shopId === shopId ||
        (user.shopId === shop.primaryShopId &&
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
