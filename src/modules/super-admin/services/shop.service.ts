import { prisma } from "../../../config/prisma.js";
import { Prisma } from "../../../database/prisma/generated/prisma/client.js";
import { NotFoundError } from "../../../utils/errors.js";
import { LATEST_SUBSCRIPTION_ORDER } from "../../../helpers/subscription-order.js";

type ShopListFilters = {
  page?: number;
  limit?: number;
  q?: string;
  status?: string;   // Shop.status (e.g. ACTIVE / SUSPENDED)
  plan?: string;      // Plan.code (e.g. FREE / BASIC / PRO / PREMIUM)
};

export const SuperAdminShopService = {
  listShops: async (filters: ShopListFilters) => {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 ? filters.limit : 20;
    const skip = (page - 1) * limit;

    // Filtre par plan : on ne garde que les boutiques dont l'abonnement COURANT
    // (le plus récent) correspond, comme ce qui est affiché dans la liste.
    let planShopIds: number[] | undefined;
    if (filters.plan) {
      const latestPerShop = await prisma.subscription.findMany({
        distinct: ["shopId"],
        orderBy: [{ shopId: "asc" }, ...LATEST_SUBSCRIPTION_ORDER],
        select: { shopId: true, plan: { select: { code: true } } },
      });
      const billingShopIds = latestPerShop
        .filter((sub) => sub.plan.code === filters.plan)
        .map((sub) => sub.shopId);
      const secondaryShops = await prisma.shop.findMany({
        where: { primaryShopId: { in: billingShopIds } },
        select: { id: true },
      });
      planShopIds = [...billingShopIds, ...secondaryShops.map((shop) => shop.id)];
    }

    const where: Prisma.ShopWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.q
        ? {
            OR: [
              { name: { contains: filters.q, mode: "insensitive" } },
              { email: { contains: filters.q, mode: "insensitive" } },
              { ownerName: { contains: filters.q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(planShopIds ? { id: { in: planShopIds } } : {}),
    };

    const [shops, total] = await Promise.all([
      prisma.shop.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          primaryShop: {
            select: {
              subscriptions: {
                include: { plan: true },
                orderBy: LATEST_SUBSCRIPTION_ORDER,
                take: 1,
              },
            },
          },
          subscriptions: {
            include: { plan: true },
            orderBy: LATEST_SUBSCRIPTION_ORDER,
            take: 1,
          },
          _count: {
            select: { users: true, products: true, sales: true },
          },
        },
      }),
      prisma.shop.count({ where }),
    ]);

    const data = shops.map((shop) => {
      const subscription =
        shop.primaryShop?.subscriptions[0] ?? shop.subscriptions[0] ?? null;
      const subscriptionInherited = !!shop.primaryShop;

      return {
        id: shop.id,
        name: shop.name,
        ownerName: shop.ownerName,
        email: shop.email,
        phone: shop.phone,
        status: shop.status,
        createdAt: shop.createdAt,
        subscriptionInherited,
        billingShopId: shop.primaryShopId ?? shop.id,
        subscription: subscription
          ? {
              status: subscription.status,
              endDate: subscription.endDate,
              plan: {
                code: subscription.plan.code,
                name: subscription.plan.name,
                price: subscription.plan.price,
              },
            }
          : null,
        counts: {
          users: shop._count.users,
          products: shop._count.products,
          sales: shop._count.sales,
        },
      };
    });

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  },


// shop details
  getShopDetail: async (shopId: number) => {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: {
      primaryShop: {
        select: {
          id: true,
          name: true,
          status: true,
          subscriptions: {
            include: { plan: true },
            orderBy: LATEST_SUBSCRIPTION_ORDER,
            take: 1,
          },
        },
      },
      secondaryShops: { select: { id: true, name: true, status: true } },
      subscriptions: {
        include: { plan: true },
        orderBy: LATEST_SUBSCRIPTION_ORDER,
        take: 1, // abonnement courant = le plus récent
      },
      users: {
        select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
      },
      _count: {
        select: {
          users: true,
          products: true,
          clients: true,
          suppliers: true,
          sales: true,
        },
      },
    },
  });

  if (!shop) {
    throw new NotFoundError("Shop not found");
  }

  const subscription =
    shop.primaryShop?.subscriptions[0] ?? shop.subscriptions[0] ?? null;
  const subscriptionInherited = !!shop.primaryShopId;

  const [salesRevenue, payments, auditLogs] = await Promise.all([
    prisma.sale.aggregate({
      where: { shopId },
      _sum: { totalAmount: true },
    }),
    subscription
      ? prisma.payment.findMany({
          where: { subscriptionId: subscription.id },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
    prisma.auditLog.findMany({
      where: {
        targetType: { in: ["Shop", "Subscription"] },
        targetId: shopId,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return {
    id: shop.id,
    name: shop.name,
    ownerName: shop.ownerName,
    email: shop.email,
    phone: shop.phone,
    address: shop.address,
    logoUrl: shop.logoUrl,
    status: shop.status,
    currentShop: shop.currentShop,
    createdAt: shop.createdAt,
    primaryShop: shop.primaryShop
      ? { id: shop.primaryShop.id, name: shop.primaryShop.name }
      : null,
    secondaryShops: shop.secondaryShops,
    subscriptionInherited,
    billingShopId: shop.primaryShopId ?? shop.id,
    subscription: subscription
      ? {
          id: subscription.id,
          status: subscription.status,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          plan: {
            code: subscription.plan.code,
            name: subscription.plan.name,
            price: subscription.plan.price,
            limits: {
              sales: subscription.plan.maxSalesPerMonth,
              products: subscription.plan.maxProducts,
              customers: subscription.plan.maxCustomers,
              users: subscription.plan.maxUsers,
              stores: subscription.plan.maxStores,
            },
          },
        }
      : null,
    users: shop.users,
    counts: {
      users: shop._count.users,
      products: shop._count.products,
      clients: shop._count.clients,
      suppliers: shop._count.suppliers,
      sales: shop._count.sales,
      salesRevenue: salesRevenue._sum.totalAmount ?? 0,
    },
    payments,
    auditLogs,
  };
},
};