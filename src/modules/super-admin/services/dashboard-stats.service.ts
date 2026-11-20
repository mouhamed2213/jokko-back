import { prisma } from "../../../config/prisma.js";

export const SuperAdminDashboardService = {
  getAdminProfile: async (adminId: number) => {
    return prisma.superAdmin.findUnique({
      where: { id: adminId },
      select: { id: true, name: true, email: true },
    });
  },

  getPlatformStats: async () => {
    const primaryShopFilter = { shop: { is: { primaryShopId: null } } };

    const [
      totalShops,
      shopsByStatusGroup,
      recentShops,
      recentSubscriptions,
      subsGroup,
      activeSubs,
    ] = await Promise.all([
      prisma.shop.count(),
      prisma.shop.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.shop.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          status: true,
        },
      }),
      prisma.subscription.findMany({
        where: primaryShopFilter,
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          plan: { select: { code: true, name: true, price: true } },
          shop: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.subscription.groupBy({
        by: ["status", "planId"],
        where: primaryShopFilter,
        _count: { _all: true },
      }),
      prisma.subscription.findMany({
        where: { ...primaryShopFilter, status: "ACTIVE" },
        include: { plan: { select: { code: true, price: true } } },
      }),
    ]);

    const shopsByStatus: Record<string, number> = {};
    shopsByStatusGroup.forEach((g: any) => {
      shopsByStatus[g.status] = g._count._all;
    });

    const planIds = Array.from(new Set(subsGroup.map((s: any) => s.planId)));
    const plans =
      planIds.length > 0
        ? await prisma.plan.findMany({ where: { id: { in: planIds } } })
        : [];
    const planById: Record<number, any> = {};
    plans.forEach((p) => (planById[p.id] = p));

    const subscriptionsByStatus: Record<string, number> = {};
    const subscriptionsByPlan: Record<string, number> = {};
    subsGroup.forEach((g: any) => {
      subscriptionsByStatus[g.status] =
        (subscriptionsByStatus[g.status] || 0) + g._count._all;
      const plan = planById[g.planId];
      const planCode = plan ? plan.code : String(g.planId);
      subscriptionsByPlan[planCode] =
        (subscriptionsByPlan[planCode] || 0) + g._count._all;
    });

    const mrr = activeSubs.reduce((acc, s) => {
      if (!s.plan || s.plan.code === "FREE") return acc;
      return acc + (s.plan.price || 0);
    }, 0);

    return {
      totalShops,
      shopsByStatus,
      subscriptionsByStatus,
      subscriptionsByPlan,
      mrr,
      recentShops,
      recentSubscriptions,
    };
  },
};
