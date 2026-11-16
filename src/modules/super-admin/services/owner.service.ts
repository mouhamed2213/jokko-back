import { Prisma } from "../../../database/prisma/generated/prisma/client.js";
import { prisma } from "../../../config/prisma.js";
import { LATEST_SUBSCRIPTION_ORDER } from "../../../helpers/subscription-order.js";
import { SHOP_STATUS } from "../../../helpers/shop-status.js";
import { NotFoundError } from "../../../utils/errors.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_SOON_DAYS = 7;
const INACTIVE_DAYS = 14;

type AlertLevel = "danger" | "warning" | "info";
type Alert = { level: AlertLevel; code: string; message: string };

const currentSubscriptionSelect = {
  orderBy: LATEST_SUBSCRIPTION_ORDER,
  take: 1,
  select: {
    id: true,
    status: true,
    startDate: true,
    endDate: true,
    shopOwnerId: true,
    plan: {
      select: {
        code: true,
        name: true,
        price: true,
        maxSalesPerMonth: true,
        maxProducts: true,
        maxCustomers: true,
        maxUsers: true,
        maxStores: true,
      },
    },
  },
} satisfies Prisma.Shop$subscriptionsArgs;

const num = (v: number | null | undefined) => v ?? 0;

const usageItem = (
  key: string,
  label: string,
  used: number,
  limit: number | null,
) => ({
  key,
  label,
  used,
  limit,
  percent: limit && limit > 0 ? Math.round((used / limit) * 100) : null,
});

/** Statistiques (lecture seule) d'une boutique. */
const getShopStats = async (shopId: number) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const d30 = new Date(now.getTime() - 30 * DAY_MS);

  const [
    users,
    products,
    clients,
    suppliers,
    salesThisMonth,
    sales30,
    salesAll,
    supplierDebt,
    lowStockRows,
    openCash,
    lastMovement,
  ] = await Promise.all([
    prisma.user.count({ where: { shopId } }),
    prisma.product.count({ where: { shopId, isActive: true } }),
    prisma.client.count({ where: { shopId } }),
    prisma.supplier.count({ where: { shopId } }),
    prisma.sale.count({ where: { shopId, createdAt: { gte: monthStart } } }),
    prisma.sale.aggregate({
      where: { shopId, createdAt: { gte: d30 } },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
    prisma.sale.aggregate({
      where: { shopId },
      _count: { _all: true },
      _sum: { totalAmount: true, remaining: true },
      _max: { createdAt: true },
    }),
    prisma.supplierDebt.aggregate({
      where: { supplier: { shopId } },
      _sum: { remaining: true },
    }),
    prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM products
      WHERE "shopId" = ${shopId} AND "isActive" = true AND quantity <= "alertThreshold"`,
    prisma.cashRegister.findFirst({
      where: { shopId, status: "OPEN" },
      select: { openedAt: true },
    }),
    prisma.stockMovement.aggregate({
      where: { shopId },
      _max: { createdAt: true },
    }),
  ]);

  const candidates = [
    salesAll._max.createdAt,
    lastMovement._max.createdAt,
  ].filter((d): d is Date => !!d);
  const lastActivityAt = candidates.length
    ? new Date(Math.max(...candidates.map((d) => d.getTime())))
    : null;

  return {
    counts: { users, products, clients, suppliers },
    salesThisMonth,
    sales30d: {
      count: sales30._count._all,
      revenue: num(sales30._sum.totalAmount),
    },
    salesTotal: {
      count: salesAll._count._all,
      revenue: num(salesAll._sum.totalAmount),
    },
    unpaidAmount: num(salesAll._sum.remaining),
    supplierDebtRemaining: num(supplierDebt._sum.remaining),
    lowStockCount: lowStockRows[0]?.count ?? 0,
    cashOpen: !!openCash,
    lastSaleAt: salesAll._max.createdAt,
    lastActivityAt,
  };
};

export const SuperAdminOwnerService = {
  /** Liste paginée des propriétaires avec un résumé de leur réseau. */
  listOwners: async (filters: { page?: number; limit?: number; q?: string }) => {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

    const where: Prisma.UserWhereInput = {
      ownedShops: { some: {} },
      ...(filters.q
        ? {
            OR: [
              { name: { contains: filters.q, mode: "insensitive" } },
              { email: { contains: filters.q, mode: "insensitive" } },
              {
                ownedShops: {
                  some: {
                    shop: { name: { contains: filters.q, mode: "insensitive" } },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          ownedShops: {
            select: {
              phone: true,
              shop: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                  primaryShopId: true,
                  primaryShop: {
                    select: {
                      status: true,
                      subscriptions: currentSubscriptionSelect,
                    },
                  },
                  subscriptions: currentSubscriptionSelect,
                },
              },
            },
          },
        },
      }),
    ]);

    const now = Date.now();

    const owners = users.map((u) => {
      const shops = u.ownedShops.map((o) => o.shop);
      const live = shops.filter(
        (s) =>
          s.status !== SHOP_STATUS.ARCHIVED &&
          (!s.primaryShop || s.primaryShop.status !== SHOP_STATUS.ARCHIVED),
      );
      const subs = live
        .map((s) =>
          s.primaryShopId
            ? s.primaryShop?.subscriptions[0]
            : s.subscriptions[0],
        )
        .filter(Boolean);
      const expiries = subs
        .map((s) => s.endDate)
        .filter((d): d is Date => !!d)
        .map((d) => d.getTime());

      return {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.ownedShops[0]?.phone ?? null,
        createdAt: u.createdAt,
        primaryShopName: shops.find((s) => !s.primaryShopId)?.name ?? null,
        shopsCount: shops.length,
        activeShops: live.length,
        archivedShops: shops.length - live.length,
        plans: [...new Set(subs.map((s) => s.plan.code))],
        nextExpiry: expiries.length ? new Date(Math.min(...expiries)) : null,
        expiredShops: subs.filter(
          (s) =>
            ["EXPIRED", "TRIAL_EXPIRED"].includes(s.status) ||
            (!!s.endDate && s.endDate.getTime() < now),
        ).length,
      };
    });

    return {
      data: owners,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  },

  /** Vue globale d'un propriétaire : réseau de boutiques, usage, santé, anomalies. */
  getOwnerDetail: async (userId: number) => {
    const owner = await prisma.user.findFirst({
      where: { id: userId, ownedShops: { some: {} } },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        ownedShops: {
          select: {
            id: true,
            phone: true,
            shop: {
              select: {
                id: true,
                name: true,
                status: true,
                address: true,
                logoUrl: true,
                primaryShopId: true,
                currentShop: true,
                createdAt: true,
                primaryShop: {
                  select: {
                    id: true,
                    name: true,
                    status: true,
                    subscriptions: currentSubscriptionSelect,
                  },
                },
                subscriptions: currentSubscriptionSelect,
              },
            },
          },
        },
      },
    });
    if (!owner) throw new NotFoundError("Propriétaire introuvable");

    const now = Date.now();
    const shopsRaw = owner.ownedShops
      .map((o) => o.shop)
      // principale d'abord, puis secondaires par date de création
      .sort(
        (a, b) =>
          Number(!!a.primaryShopId) - Number(!!b.primaryShopId) ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );

    const statsList = await Promise.all(shopsRaw.map((s) => getShopStats(s.id)));

    // Anomalie : l'abonnement doit pointer vers le ShopOwner de SA boutique
    const subOwnerIds = shopsRaw
      .filter((s) => !s.primaryShopId)
      .map((s) => s.subscriptions[0]?.shopOwnerId)
      .filter((id): id is number => typeof id === "number");
    const subOwners = await prisma.shopOwner.findMany({
      where: { id: { in: subOwnerIds } },
      select: { id: true, shopId: true },
    });
    const subOwnerById = new Map(subOwners.map((s) => [s.id, s]));

    const diagnostics: Alert[] = [];

    const shops = shopsRaw.map((shop, i) => {
      const stats = statsList[i];
      const ownSubscription = shop.subscriptions[0] ?? null;
      const sub = shop.primaryShop?.subscriptions[0] ?? ownSubscription;
      const subscriptionInherited = !!shop.primaryShopId;
      const archived = shop.status === SHOP_STATUS.ARCHIVED;
      const plan = sub?.plan ?? null;

      if (subscriptionInherited && ownSubscription) {
        diagnostics.push({
          level: "warning",
          code: "SECONDARY_OWN_SUBSCRIPTION",
          message: `«${shop.name}» : un ancien abonnement propre existe encore sur cette boutique secondaire ; l'abonnement de la boutique principale est appliqué.`,
        });
      }

      const usage = plan
        ? [
            usageItem("sales", "Ventes ce mois", stats.salesThisMonth, plan.maxSalesPerMonth),
            usageItem("products", "Produits", stats.counts.products, plan.maxProducts),
            usageItem("clients", "Clients", stats.counts.clients, plan.maxCustomers),
            usageItem("users", "Utilisateurs", stats.counts.users, plan.maxUsers),
          ]
        : [];

      const daysRemaining = sub?.endDate
        ? Math.ceil((sub.endDate.getTime() - now) / DAY_MS)
        : null;
      const inactiveDays = Math.floor(
        (now - (stats.lastActivityAt ?? shop.createdAt).getTime()) / DAY_MS,
      );

      const alerts: Alert[] = [];
      if (archived) {
        alerts.push({ level: "info", code: "ARCHIVED", message: "Boutique archivée" });
      } else if (shop.primaryShop?.status === SHOP_STATUS.ARCHIVED) {
        alerts.push({
          level: "danger",
          code: "PRIMARY_SHOP_ARCHIVED",
          message: `Boutique inaccessible : la boutique principale « ${shop.primaryShop.name} » est archivée`,
        });
      } else {
        if (!sub) {
          alerts.push({ level: "danger", code: "NO_SUBSCRIPTION", message: "Aucun abonnement" });
        } else {
          if (["EXPIRED", "TRIAL_EXPIRED", "SUSPENDED"].includes(sub.status)) {
            alerts.push({ level: "danger", code: "SUBSCRIPTION_" + sub.status, message: `Abonnement ${sub.status}` });
          } else if (daysRemaining !== null && daysRemaining <= 0) {
            alerts.push({ level: "danger", code: "SUBSCRIPTION_ENDED", message: "Date de fin d'abonnement dépassée" });
          } else if (daysRemaining !== null && daysRemaining <= EXPIRING_SOON_DAYS) {
            alerts.push({ level: "warning", code: "EXPIRING_SOON", message: `Abonnement : ${daysRemaining} jour(s) restant(s)` });
          }
        }
        for (const u of usage) {
          if (u.percent === null) continue;
          if (u.percent >= 100) {
            alerts.push({ level: "danger", code: "LIMIT_REACHED_" + u.key, message: `${u.label} : limite atteinte (${u.used}/${u.limit})` });
          } else if (u.percent >= 80) {
            alerts.push({ level: "warning", code: "LIMIT_NEAR_" + u.key, message: `${u.label} : ${u.percent}% de la limite` });
          }
        }
        if (inactiveDays >= INACTIVE_DAYS) {
          alerts.push({ level: "warning", code: "INACTIVE", message: `Aucune activité depuis ${inactiveDays} jours` });
        }
        if (stats.lowStockCount > 0) {
          alerts.push({ level: "info", code: "LOW_STOCK", message: `${stats.lowStockCount} produit(s) en stock bas` });
        }
      }

      // Le contrôle de cohérence porte uniquement sur l'abonnement de la boutique principale.
      if (sub && !subscriptionInherited) {
        const linked = subOwnerById.get(sub.shopOwnerId);
        if (!linked) {
          diagnostics.push({ level: "danger", code: "SUBSCRIPTION_OWNER_MISSING", message: `«${shop.name}» : l'abonnement pointe vers un propriétaire inexistant (#${sub.shopOwnerId})` });
        } else if (linked.shopId !== shop.id) {
          diagnostics.push({ level: "danger", code: "SUBSCRIPTION_OWNER_MISMATCH", message: `«${shop.name}» : l'abonnement est rattaché au propriétaire d'une autre boutique (ShopOwner #${linked.id})` });
        }
      }

      return {
        id: shop.id,
        name: shop.name,
        status: shop.status,
        address: shop.address,
        logoUrl: shop.logoUrl,
        isPrimary: !shop.primaryShopId,
        primaryShopId: shop.primaryShopId,
        primaryShop: shop.primaryShop
          ? {
              id: shop.primaryShop.id,
              name: shop.primaryShop.name,
              status: shop.primaryShop.status,
            }
          : null,
        subscriptionInherited,
        createdAt: shop.createdAt,
        subscription: sub
          ? {
              status: sub.status,
              startDate: sub.startDate,
              endDate: sub.endDate,
              daysRemaining,
              plan: {
                code: plan!.code,
                name: plan!.name,
                price: plan!.price,
              },
            }
          : null,
        usage,
        stats: { ...stats, inactiveDays },
        alerts,
      };
    });

    // Usage réseau : nombre de boutiques secondaires vs limite du plan de la principale
    const primary = shops.find((s) => s.isPrimary);
    const primaryPlan = shopsRaw.find((s) => !s.primaryShopId)?.subscriptions[0]?.plan;
    const secondariesActive = shops.filter(
      (s) => !s.isPrimary && s.status !== SHOP_STATUS.ARCHIVED,
    ).length;
    const storesUsage = usageItem("stores", "Boutiques secondaires", secondariesActive, primaryPlan?.maxStores ?? null);
    if (storesUsage.percent !== null && storesUsage.percent > 100) {
      diagnostics.push({ level: "warning", code: "STORES_OVER_LIMIT", message: `Le réseau dépasse la limite du plan (${storesUsage.used}/${storesUsage.limit} boutiques secondaires)` });
    }

    const live = shops.filter(
      (s) =>
        s.status !== SHOP_STATUS.ARCHIVED &&
        (!s.primaryShop || s.primaryShop.status !== SHOP_STATUS.ARCHIVED),
    );
    const sum = (f: (s: (typeof shops)[number]) => number, list = shops) =>
      list.reduce((acc, s) => acc + f(s), 0);

    return {
      owner: {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        phone: owner.ownedShops[0]?.phone ?? null,
        createdAt: owner.createdAt,
        primaryShopId: primary?.id ?? null,
      },
      totals: {
        shopsCount: shops.length,
        activeShops: live.length,
        archivedShops: shops.length - live.length,
        revenue30d: sum((s) => s.stats.sales30d.revenue, live),
        sales30d: sum((s) => s.stats.sales30d.count, live),
        revenueTotal: sum((s) => s.stats.salesTotal.revenue),
        unpaidAmount: sum((s) => s.stats.unpaidAmount, live),
        supplierDebtRemaining: sum((s) => s.stats.supplierDebtRemaining, live),
        users: sum((s) => s.stats.counts.users, live),
        products: sum((s) => s.stats.counts.products, live),
        lowStockCount: sum((s) => s.stats.lowStockCount, live),
        alertsCount: sum((s) => s.alerts.filter((a) => a.level !== "info").length, live),
      },
      storesUsage,
      shops,
      diagnostics,
    };
  },
};
