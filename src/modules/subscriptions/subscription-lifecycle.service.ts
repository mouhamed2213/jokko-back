import { prisma } from "../../config/prisma.js";

export const DEFAULT_GRACE_PERIOD_DAYS = 5;
export const MAX_GRACE_PERIOD_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

type SubscriptionLifecycleInput = {
  id: number;
  shopOwnerId: number;
  planId: number;
  status: "ACTIVE" | "TRIAL" | "EXPIRED" | "TRIAL_EXPIRED" | "SUSPENDED";
  endDate: Date | null;
  gracePeriodEndsAt: Date | null;
  plan: { code: string };
};

const initializeGraceDeadline = async (
  subscription: SubscriptionLifecycleInput,
  gracePeriodDays: number,
): Promise<Date | null> => {
  if (subscription.gracePeriodEndsAt) {
    return subscription.gracePeriodEndsAt;
  }
  const endDate = subscription.endDate;
  if (!endDate) return null;

  const deadline = new Date(
    endDate.getTime() + gracePeriodDays * DAY_MS,
  );
  const initialized = await prisma.subscription.updateMany({
    where: {
      id: subscription.id,
      shopOwnerId: subscription.shopOwnerId,
      planId: subscription.planId,
      status: subscription.status as "ACTIVE" | "TRIAL",
      endDate: subscription.endDate,
      gracePeriodEndsAt: null,
    },
    data: { gracePeriodEndsAt: deadline },
  });

  if (initialized.count === 1) return deadline;

  // Une autre requête a pu initialiser la date ou renouveler l'abonnement.
  const latest = await prisma.subscription.findUnique({
    where: { id: subscription.id },
    select: {
      shopOwnerId: true,
      planId: true,
      status: true,
      endDate: true,
      gracePeriodEndsAt: true,
    },
  });

  if (
    !latest ||
    latest.shopOwnerId !== subscription.shopOwnerId ||
    latest.planId !== subscription.planId ||
    latest.status !== subscription.status ||
    latest.endDate?.getTime() !== endDate.getTime()
  ) {
    return null;
  }

  return latest.gracePeriodEndsAt;
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
      gracePeriodEndsAt: subscription.gracePeriodEndsAt,
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
    subscription: Pick<
      SubscriptionLifecycleInput,
      "status" | "endDate" | "gracePeriodEndsAt" | "plan"
    >,
    gracePeriodDays: number,
    now = new Date(),
  ) => {
    const { status, endDate, gracePeriodEndsAt, plan } = subscription;
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

    const deadline =
      gracePeriodEndsAt ??
      new Date(endDate.getTime() + gracePeriodDays * DAY_MS);

    if (now.getTime() < endDate.getTime()) {
      return {
        status,
        gracePeriodEndsAt: null as Date | null,
        gracePeriodDaysRemaining: 0,
      };
    }

    if (
      deadline.getTime() > endDate.getTime() &&
      now.getTime() < deadline.getTime()
    ) {
      return {
        status: "GRACE_PERIOD",
        gracePeriodEndsAt: deadline,
        gracePeriodDaysRemaining: Math.max(
          1,
          Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS),
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
      (subscription.status !== "ACTIVE" && subscription.status !== "TRIAL") ||
      subscription.endDate.getTime() > Date.now()
    ) {
      return false;
    }

    const gracePeriodDays = await SubscriptionLifecycleService.getGracePeriodDays();
    const deadline = await initializeGraceDeadline(
      subscription,
      gracePeriodDays,
    );
    if (!deadline || new Date().getTime() < deadline.getTime()) {
      return false;
    }

    const freePlan = await prisma.plan.findUnique({
      where: { code: "FREE" },
      select: { id: true },
    });
    if (!freePlan) {
      throw new Error("Le forfait gratuit (FREE) est introuvable.");
    }

    return applyDowngrade(
      { ...subscription, gracePeriodEndsAt: deadline },
      freePlan.id,
    );
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
        gracePeriodEndsAt: true,
        plan: { select: { code: true } },
      },
    });

    const gracePeriodDays = await SubscriptionLifecycleService.getGracePeriodDays();
    const due: SubscriptionLifecycleInput[] = [];

    for (const subscription of candidates) {
      if (subscription.plan.code === "FREE" || !subscription.endDate) continue;
      const deadline = await initializeGraceDeadline(
        subscription,
        gracePeriodDays,
      );
      if (deadline && now.getTime() >= deadline.getTime()) {
        due.push({ ...subscription, gracePeriodEndsAt: deadline });
      }
    }

    if (due.length === 0) {
      return { checked: candidates.length, downgraded: 0 };
    }

    const freePlan = await prisma.plan.findUnique({
      where: { code: "FREE" },
      select: { id: true },
    });
    if (!freePlan) {
      throw new Error("Le forfait gratuit (FREE) est introuvable.");
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
