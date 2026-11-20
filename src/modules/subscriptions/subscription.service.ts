import { prisma } from "../../config/prisma.js";
import { Prisma } from "../../database/prisma/generated/prisma/client.js";
import { dateManagement } from "../../helpers/dates.js";
import {
  AppError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntity,
} from "../../utils/errors.js";
import { SubscriptionLifecycleService } from "./subscription-lifecycle.service.js";

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

const resolveBillingOwner = async (shopId: number, ownerUserId: number) => {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { id: true, primaryShopId: true },
  });

  if (!shop) {
    throw new NotFoundError("Boutique introuvable");
  }

  const ownership = await prisma.shopOwner.findFirst({
    where: { userId: ownerUserId, shopId },
    select: { id: true },
  });
  if (!ownership) {
    throw new ForbiddenError("Cette boutique ne vous appartient pas");
  }

  const billingShopId = shop.primaryShopId ?? shop.id;
  const billingOwner = await prisma.shopOwner.findFirst({
    where: { userId: ownerUserId, shopId: billingShopId },
    select: { id: true },
  });

  if (!billingOwner) {
    throw new NotFoundError("Propriétaire de la boutique principale introuvable");
  }

  return { billingShopId, billingOwnerId: billingOwner.id };
};

const subscriptionInclude = {
  plan: {
    include: {
      planFeature: {
        include: {
          feature: true,
        },
      },
    },
  },
} satisfies Prisma.SubscriptionInclude;

export const SubscriptionService = {
  currentSubscription: async (shopId: number, ownerUserId: number) => {
    const { billingShopId, billingOwnerId } = await resolveBillingOwner(
      shopId,
      ownerUserId,
    );

    let subscription = await prisma.subscription.findFirst({
      where: {
        shopId: billingShopId,
        shopOwnerId: billingOwnerId,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: subscriptionInclude,
    });

    if (!subscription) {
      throw new NotFoundError("No active subscription");
    }

    subscription = await SubscriptionService.ensureSubscriptionIsValid(
      subscription,
      billingOwnerId,
    );

    const gracePeriodDays =
      await SubscriptionLifecycleService.getGracePeriodDays();
    const lifecycle = SubscriptionLifecycleService.getLifecycleInfo(
      subscription,
      gracePeriodDays,
    );

    return {
      id: subscription.id,
      status: lifecycle.status,
      endDate: subscription.endDate,
      gracePeriodDays,
      gracePeriodEndsAt: lifecycle.gracePeriodEndsAt,
      gracePeriodDaysRemaining: lifecycle.gracePeriodDaysRemaining,
      isInGracePeriod: lifecycle.status === "GRACE_PERIOD",
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
    if (
      subscription.plan.code === "FREE" ||
      !subscription.endDate ||
      (subscription.status !== "ACTIVE" && subscription.status !== "TRIAL")
    ) {
      return subscription;
    }

    const endDate = subscription.endDate;
    const wasDowngraded =
      await SubscriptionLifecycleService.processSubscription({
        id: subscription.id,
        shopOwnerId,
        planId: subscription.planId,
        status: subscription.status,
        endDate: subscription.endDate,
        gracePeriodEndsAt: subscription.gracePeriodEndsAt,
        plan: { code: subscription.plan.code },
      });

    // Si la date d'échéance est atteinte, recharger aussi le cas où un
    // renouvellement concurrent vient de modifier l'abonnement pendant le
    // traitement de l'expiration.
    if (!wasDowngraded && endDate.getTime() > Date.now()) {
      return subscription;
    }

    const refreshed = await prisma.subscription.findUnique({
      where: { id: subscription.id },
      include: subscriptionInclude,
    });

    return refreshed ?? subscription;
  },

  renewal: async (
    subscriptionId: number,
    shopOwnerId: number,
    selectedPlanId: number,
  ) => {
    const dateFn = dateManagement();
    return prisma.subscription.update({
      where: { id: subscriptionId, shopOwnerId },
      data: {
        planId: selectedPlanId,
        status: "ACTIVE",
        startDate: dateFn.startDate,
        endDate: dateFn.endSubscriptionSate,
        gracePeriodEndsAt: null,
      },
      include: subscriptionInclude,
    });
  },

  /**
   * Prolonge la date de fin d'un abonnement actif ou en période de grâce.
   * Le plan FREE n'a pas de date de fin à prolonger.
   */
  extendSubscription: async (data: {
    shopOwnerId: number;
    extendToDate: string | Date;
    shopId: number;
  }) => {
    if (!data.extendToDate) {
      throw new BadRequestError(
        "La date de prolongement n'est pas fournie ou est incorrecte",
      );
    }

    const parsedExtendToDate = new Date(data.extendToDate);
    if (isNaN(parsedExtendToDate.getTime())) {
      throw new BadRequestError("La date de prolongement est invalide");
    }

    const { billingOwnerId } = await resolveBillingOwner(
      data.shopId,
      data.shopOwnerId,
    );
    const subscription = await SubscriptionService.currentSubscription(
      data.shopId,
      data.shopOwnerId,
    );

    if (subscription.plan.code === "FREE") {
      throw new BadRequestError(
        "Le plan gratuit ne peut pas être prolongé. Souscrivez à un plan payant.",
      );
    }

    if (!["ACTIVE", "GRACE_PERIOD"].includes(subscription.status)) {
      throw new UnprocessableEntity(
        "Seul un abonnement actif ou en période de grâce peut être prolongé. Renouvelez l'abonnement s'il est expiré.",
      );
    }

    const endDate = subscription.endDate;
    if (!endDate) {
      throw new AppError(
        "Erreur de prolongement : aucune date de fin définie pour cet abonnement.",
      );
    }

    if (parsedExtendToDate.getTime() <= endDate.getTime()) {
      throw new BadRequestError(
        "La nouvelle date doit être postérieure à la date de fin actuelle de l'abonnement.",
      );
    }

    return prisma.subscription.update({
      where: { id: subscription.id, shopOwnerId: billingOwnerId },
      data: { endDate: parsedExtendToDate, gracePeriodEndsAt: null },
      include: subscriptionInclude,
    });
  },

  extendPrimarySubscription: async (
    shopId: number,
    userId: number,
    ownerId: number,
    extendToDate: Date | string,
  ) => {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { primaryShopId: true },
    });
    if (!shop || shop.primaryShopId !== null || userId !== ownerId) {
      throw new ForbiddenError(
        "La gestion de l'abonnement est réservée au propriétaire depuis la boutique principale.",
      );
    }

    return SubscriptionService.extendSubscription({
      shopId,
      shopOwnerId: ownerId,
      extendToDate,
    });
  },
};
