import { prisma } from "../config/prisma.js";

export const DEFAULT_GRACE_PERIOD_DAYS = 5;
export const MAX_GRACE_PERIOD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

type SubscriptionLifecycleInput = {
  id: number;
  shopOwnerId: number;
  planId: number;
  status: string;
  endDate: Date | null;
  plan: { code: string };
};

const applyDowngrade = async (
  subscription: SubscriptionLifecycleInput,
  freePlanId: number,
) => {
  const result = await prisma.subscription.updateMany({
    where: {
      id: subscription.id,
      shopOwnerId: subscription.shopOwnerId,
      planId: subscription.planId,
      status: subscription.status as "ACTIVE" | "TRIAL",
      endDate: subscription.endDate,
    },
    data: {
      planId: freePlanId,
      status: subscription.status === "TRIAL" ? "TRIAL_EXPIRED" : "EXPIRED",
      endDate: null,
    },
  });
  return result.count === 1;
};

export const SubscriptionLifecycleService = {
  getGracePeriodDays: async (): Promise<number> => {
    const settings = await prisma.platformSetting.findUnique({
      where: { id: "global" },
      select: { gracePeriodDays: true },
    });
    return settings?.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS;
  },

  updateGracePeriodDays: async (days: number) => {
    if (
      !Number.isInteger(days) ||
      days < 0 ||
      days > MAX_GRACE_PERIOD_DAYS
    ) {
      throw new Error(
        `La durée de grâce doit être un entier compris entre 0 et ${MAX_GRACE_PERIOD_DAYS} jours.`,
      );
    }

    const settings = await prisma.platformSetting.upsert({
      where: { id: "global" },
      create: { id: "global", gracePeriodDays: days },
      update: { gracePeriodDays: days },
      select: { gracePeriodDays: true, updatedAt: true },
    });

    return {
      days: settings.gracePeriodDays,
      updatedAt: settings.updatedAt,
    };
  },

  getLifecycleInfo: (
    subscription: Pick<SubscriptionLifecycleInput, "status" | "endDate" | "plan">,
    gracePeriodDays: number,
    now = new Date(),
  ) => {
    const { status, endDate, plan } = subscription;
    const eligible =
      plan.code !== "FREE" &&
      !!endDate &&
      (status === "ACTIVE" || status === "TRIAL");

    if (!eligible || !endDate) {
      return {
        status,
        gracePeriodEndsAt: null as Date | null,
        gracePeriodDaysRemaining: 0,
      };
    }

    const gracePeriodEndsAt = new Date(
      endDate.getTime() + gracePeriodDays * DAY_MS,
    );

    if (now.getTime() < endDate.getTime()) {
      return {
        status,
        gracePeriodEndsAt: null as Date | null,
        gracePeriodDaysRemaining: 0,
      };
    }

    if (gracePeriodDays > 0 && now.getTime() < gracePeriodEndsAt.getTime()) {
      return {
        status: "GRACE_PERIOD",
        gracePeriodEndsAt,
        gracePeriodDaysRemaining: Math.max(
          1,
          Math.ceil((gracePeriodEndsAt.getTime() - now.getTime()) / DAY_MS),
        ),
      };
    }

    return {
      status: status === "TRIAL" ? "TRIAL_EXPIRED" : "EXPIRED",
      gracePeriodEndsAt: null as Date | null,
      gracePeriodDaysRemaining: 0,
    };
  },

  processSubscription: async (subscription: SubscriptionLifecycleInput) => {
    if (
      subscription.plan.code === "FREE" ||
      !subscription.endDate ||
      (subscription.status !== "ACTIVE" && subscription.status !== "TRIAL")
    ) {
      return false;
    }

    const gracePeriodDays = await SubscriptionLifecycleService.getGracePeriodDays();
    const now = new Date();
    const gracePeriodEndsAt = new Date(
      subscription.endDate.getTime() + gracePeriodDays * DAY_MS,
    );

    if (now.getTime() < gracePeriodEndsAt.getTime()) {
      return false;
    }

    const freePlan = await prisma.plan.findUnique({
      where: { code: "FREE" },
      select: { id: true },
    });
    if (!freePlan) {
      throw new Error("Le forfait Essentielle (FREE) est introuvable.");
    }

    return applyDowngrade(subscription, freePlan.id);
  },

  processExpiredSubscriptions: async () => {
    const now = new Date();
    const candidates = await prisma.subscription.findMany({
      where: {
        shop: { is: { primaryShopId: null } },
        status: { in: ["ACTIVE", "TRIAL"] },
        endDate: { not: null, lte: now },
      },
      select: {
        id: true,
        shopOwnerId: true,
        planId: true,
        status: true,
        endDate: true,
        plan: { select: { code: true } },
      },
    });

    const gracePeriodDays = await SubscriptionLifecycleService.getGracePeriodDays();
    const due = candidates.filter((subscription) => {
      if (subscription.plan.code === "FREE" || !subscription.endDate) return false;
      const gracePeriodEndsAt = new Date(
        subscription.endDate.getTime() + gracePeriodDays * DAY_MS,
      );
      return now.getTime() >= gracePeriodEndsAt.getTime();
    });

    if (due.length === 0) {
      return { checked: candidates.length, downgraded: 0 };
    }

    const freePlan = await prisma.plan.findUnique({
      where: { code: "FREE" },
      select: { id: true },
    });
    if (!freePlan) {
      throw new Error("Le forfait Essentielle (FREE) est introuvable.");
    }

    let downgraded = 0;
    for (const subscription of due) {
      if (await applyDowngrade(subscription, freePlan.id)) {
        downgraded += 1;
      }
    }

    return { checked: candidates.length, downgraded };
  },
};
