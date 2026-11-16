import { prisma } from "../config/prisma.js";
import { NotFoundError } from "../utils/errors.js";

export const AuthService = {
  getMe: async (userId: number, shopId: number) => {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
        AND: {
          shopId: shopId,
        },
      },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundError("not found");
    }

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
    const inheritedSubscriptions = shop.primaryShop?.subscriptions ?? shop.subscriptions;

    return {
      ...shop,
      subscriptions: inheritedSubscriptions,
      subscriptionInherited: !!shop.primaryShopId,
      billingShopId: shop.primaryShopId ?? shop.id,
    };
  },
};
