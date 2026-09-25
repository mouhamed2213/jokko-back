import { prisma } from "../config/prisma.js";
import { Prisma } from "../database/prisma/generated/prisma/client.js";
import { dateManagement } from "../helpers/dates.js";
import {
  AppError,
  BadRequestError,
  NotFoundError,
  UnprocessableEntity,
} from "../utils/errors.js";

type SubscriptionWithPlan = Prisma.SubscriptionGetPayload<{
  include: {
    plan: {
      include: {
        planFeature: {
          include: {
            feature: true;
          };
        };
      };
    };
  };
}>;

export const SubscriptionService = {
  currentSubscription: async (shopId: number, shopOwnerId: number) => {
    let subscription: SubscriptionWithPlan | null =
      await prisma.subscription.findFirst({
        where: {
          shopId: shopId,
        },
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
      });

    if (!subscription) {
      throw new NotFoundError("No active subscription");
    }

    subscription = await SubscriptionService.ensureSubscriptionIsValid(
      subscription,
      shopOwnerId,
    );

    return {
      id: subscription.id,
      status: subscription.status,
      endDate: subscription?.endDate,

      plan: {
        code: subscription.plan.code,
        name: subscription.plan.name,
      },

      limits: {
        sales: subscription.plan.maxSalesPerMonth,
        products: subscription.plan.maxProducts,
        customers: subscription.plan.maxCustomers,
        users: subscription.plan.maxUsers,
        stores: subscription.plan.maxStores,
        suppliers: subscription.plan.maxSuppliers,
      },

      features: subscription.plan.planFeature.map((pf) => pf.feature.code),
    };
  },

  ensureSubscriptionIsValid: async (
    subscription: SubscriptionWithPlan,
    shopOwnerId: number,
  ): Promise<SubscriptionWithPlan> => {
    if (subscription.plan.code === "FREE") {
      return subscription;
    }

    if (!subscription.endDate) {
      return subscription;
    }

    // const now = new Date("2026-09-07T18:44:35.348Z");
    const now = new Date();
    // Trial still active
    if (subscription.endDate > now) {
      return subscription;
    }

    // Downgrade if endDate
    return SubscriptionService.downgradeToFree(subscription, shopOwnerId);
  },

  downgradeToFree: async (
    subscription: SubscriptionWithPlan,
    shopOwnerId: number,
  ): Promise<SubscriptionWithPlan> => {
    const freePlan = await prisma.plan.findUnique({
      where: {
        code: "FREE",
      },
    });

    if (!freePlan) {
      throw new NotFoundError("Free plan not found");
    }

    const subcriptionStatus = subscription.status;
    // end subscripton status condtion
    const status =
      subcriptionStatus === "TRIAL"
        ? "TRIAL_EXPIRED"
        : subcriptionStatus === "ACTIVE"
          ? "EXPIRED"
          : "EXPIRED";

    return prisma.subscription.update({
      where: {
        id: subscription.id,
        shopOwnerId,
        // status : "EXPIRED"
      },
      data: {
        planId: freePlan.id,
        status,
        endDate: null,
      },
      include: {
        shop: true,
        shopOwner: true,
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
    });
  },

  renewal: async (
    subscriptionId: number,
    shopOwnerId: number,
    selectedPlanId: number,
  ) => {
    const dateFn = dateManagement();
    const update = await prisma.subscription.update({
      where: { id: subscriptionId, shopOwnerId },
      data: {
        planId: selectedPlanId,
        status: "ACTIVE",
        startDate: dateFn.startDate,
        endDate: dateFn.endSubscriptionSate,
      },
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
    });

    return update;
  },

  /**
   * Prolonge la date de fin d'un abonnement actif (ex : geste commercial,
   * correction manuelle par un admin). Ne s'applique qu'aux abonnements
   * payants actifs ; un abonnement expiré doit être renouvelé (`renewal`),
   * et le plan FREE n'a pas de date de fin à prolonger.
   */
  extendSubscription: async (data: {
    shopOwnerId: number;
    extendToDate: string | Date;
    shopId: number;
  }) => {
    // 1. La nouvelle date de fin doit être fournie
    if (!data.extendToDate) {
      throw new BadRequestError(
        "La date de prolongement n'est pas fournie ou est incorrecte",
      );
    }

    const parsedExtendToDate = new Date(data.extendToDate);
    if (isNaN(parsedExtendToDate.getTime())) {
      throw new BadRequestError("La date de prolongement est invalide");
    }

    const subscription = await SubscriptionService.currentSubscription(
      data.shopId,
      data.shopOwnerId,
    );

    // 2. Le plan FREE n'a pas d'abonnement payant à prolonger
    if (subscription.plan.code === "FREE") {
      throw new BadRequestError(
        "Le plan gratuit ne peut pas être prolongé. Souscrivez à un plan payant.",
      );
    }

    // 3. Seul un abonnement actif peut être prolongé (sinon : renouvellement)
    if (subscription.status !== "ACTIVE") {
      throw new UnprocessableEntity(
        "Seul un abonnement actif peut être prolongé. Renouvelez l'abonnement s'il est expiré.",
      );
    }

    const endDate = subscription.endDate;
    if (!endDate) {
      throw new AppError("Erreur de prolongement : aucune date de fin définie pour cet abonnement.");
    }

    // 4. La nouvelle date doit être postérieure à la date de fin actuelle
    if (parsedExtendToDate.getTime() <= endDate.getTime()) {
      throw new BadRequestError(
        "La nouvelle date doit être postérieure à la date de fin actuelle de l'abonnement.",
      );
    }

    return prisma.subscription.update({
      where: { id: subscription.id, shopOwnerId: data.shopOwnerId },
      data: { endDate: parsedExtendToDate },
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
    });
  },
};
