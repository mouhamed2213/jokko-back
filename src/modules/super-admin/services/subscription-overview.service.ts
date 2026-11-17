import { prisma } from "../../../config/prisma.js";
import { SubscriptionLifecycleService } from "../../../services/subscription-lifecycle.service.js";
import { LATEST_SUBSCRIPTION_ORDER } from "../../../helpers/subscription-order.js";

type SubscriptionFilters = {
  page?: number;
  limit?: number;
  q?: string;
  status?: string;
  plan?: string;
};

const normalizeStatus = (value: string | undefined) =>
  String(value ?? "").trim().toUpperCase();

export const SubscriptionOverviewService = {
  list: async (filters: SubscriptionFilters) => {
    // Exécute le rattrapage avant la lecture pour que les boutiques ayant
    // dépassé leur grâce soient déjà rétrogradées vers FREE.
    await SubscriptionLifecycleService.processExpiredSubscriptions();

    const gracePeriodDays = await SubscriptionLifecycleService.getGracePeriodDays();
    const subscriptions = await prisma.subscription.findMany({
      where: { shop: { is: { primaryShopId: null } } },
      distinct: ["shopId"],
      orderBy: [{ shopId: "asc" }, ...LATEST_SUBSCRIPTION_ORDER],
      include: {
        shop: {
          select: {
            id: true,
            name: true,
            email: true,
            ownerName: true,
            status: true,
          },
        },
        shopOwner: {
          select: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
        plan: { select: { code: true, name: true, price: true } },
        subsctiption: {
          where: { paymentType: { in: ["SUBSCRIPTION", "RENEWAL"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            provider: true,
            amount: true,
            paidAt: true,
            createdAt: true,
            paymentType: true,
          },
        },
      },
    });

    const now = new Date();
    let rows = subscriptions.map((subscription) => {
      const lifecycle = SubscriptionLifecycleService.getLifecycleInfo(
        subscription,
        gracePeriodDays,
        now,
      );
      const latestPayment = subscription.subsctiption[0] ?? null;

      return {
        id: subscription.id,
        shopId: subscription.shopId,
        shop: subscription.shop,
        owner: subscription.shopOwner.user,
        plan: subscription.plan,
        status: lifecycle.status,
        storedStatus: subscription.status,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        gracePeriodEndsAt: lifecycle.gracePeriodEndsAt,
        gracePeriodDaysRemaining: lifecycle.gracePeriodDaysRemaining,
        latestPayment,
        createdAt: subscription.createdAt,
      };
    });

    const q = String(filters.q ?? "").trim().toLocaleLowerCase("fr");
    const status = normalizeStatus(filters.status);
    const plan = normalizeStatus(filters.plan);

    if (q) {
      rows = rows.filter((row) =>
        [
          row.shop.name,
          row.shop.email,
          row.shop.ownerName,
          row.owner.name,
          row.owner.email,
        ].some((value) => value.toLocaleLowerCase("fr").includes(q)),
      );
    }
    if (status) rows = rows.filter((row) => row.status === status);
    if (plan) rows = rows.filter((row) => row.plan.code === plan);

    rows.sort((a, b) => {
      const aDate = a.gracePeriodEndsAt ?? a.endDate ?? a.createdAt;
      const bDate = b.gracePeriodEndsAt ?? b.endDate ?? b.createdAt;
      return aDate.getTime() - bDate.getTime();
    });

    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const total = rows.length;

    return {
      data: rows.slice((page - 1) * limit, page * limit),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      gracePeriodDays,
    };
  },

  getOverviewStats: async () => {
    await SubscriptionLifecycleService.processExpiredSubscriptions();

    const gracePeriodDays = await SubscriptionLifecycleService.getGracePeriodDays();
    const subscriptions = await prisma.subscription.findMany({
      where: { shop: { is: { primaryShopId: null } } },
      distinct: ["shopId"],
      orderBy: [{ shopId: "asc" }, ...LATEST_SUBSCRIPTION_ORDER],
      select: {
        status: true,
        endDate: true,
        gracePeriodEndsAt: true,
        plan: { select: { code: true, price: true } },
      },
    });

    const counts: Record<string, number> = {
      ACTIVE: 0,
      TRIAL: 0,
      GRACE_PERIOD: 0,
      EXPIRED: 0,
      TRIAL_EXPIRED: 0,
      SUSPENDED: 0,
    };
    const subscriptionsByPlan: Record<string, number> = {};
    let mrr = 0;
    let activePaidCount = 0;
    for (const subscription of subscriptions) {
      subscriptionsByPlan[subscription.plan.code] =
        (subscriptionsByPlan[subscription.plan.code] ?? 0) + 1;
      const status = SubscriptionLifecycleService.getLifecycleInfo(
        subscription,
        gracePeriodDays,
      ).status;
      counts[status] = (counts[status] ?? 0) + 1;
      if (status === "ACTIVE" && subscription.plan.code !== "FREE") {
        mrr += subscription.plan.price;
        activePaidCount += 1;
      }
    }

    const latestSubscriptions = await prisma.subscription.findMany({
      where: { shop: { is: { primaryShopId: null } } },
      distinct: ["shopId"],
      orderBy: [{ shopId: "asc" }, ...LATEST_SUBSCRIPTION_ORDER],
      include: {
        shop: { select: { id: true, name: true, email: true } },
        plan: { select: { code: true, name: true, price: true } },
      },
    });

    const recentSubscriptions = latestSubscriptions
      .map((subscription) => ({
        id: subscription.id,
        shopId: subscription.shopId,
        status: SubscriptionLifecycleService.getLifecycleInfo(
          subscription,
          gracePeriodDays,
        ).status,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        plan: subscription.plan,
        shop: subscription.shop,
        createdAt: subscription.createdAt,
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10);

    const pendingPayments = await prisma.payment.count({
      where: {
        status: "PENDING",
        paymentType: { in: ["SUBSCRIPTION", "RENEWAL"] },
        subscription: {
          is: { shop: { is: { primaryShopId: null } } },
        },
      },
    });

    return {
      subscriptionsByStatus: counts,
      subscriptionsByPlan,
      gracePeriodCount: counts.GRACE_PERIOD,
      expiredCount: counts.EXPIRED + counts.TRIAL_EXPIRED,
      pendingSubscriptionPayments: pendingPayments,
      gracePeriodDays,
      mrr,
      activePaidCount,
      recentSubscriptions,
    };
  },
};
