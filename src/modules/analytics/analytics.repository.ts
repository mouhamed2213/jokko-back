import { prisma } from "../../config/prisma.js";
import { Prisma } from "../../database/prisma/generated/prisma/client.js";
import type { AnalyticsPeriod } from "./analytics.types.js";

export const AnalyticsRepository = {
  getSalesAggregate: (shopId: number, period: AnalyticsPeriod) =>
    prisma.sale.aggregate({
      where: {
        shopId,
        createdAt: { gte: period.startDate, lte: period.endDate },
      },
      _count: { _all: true },
      _sum: { totalAmount: true, remaining: true },
    }),

  getPaymentAggregate: (shopId: number, period: AnalyticsPeriod) =>
    prisma.salePayment.aggregate({
      where: {
        sale: { shopId },
        paidAt: { gte: period.startDate, lte: period.endDate },
      },
      _sum: { amount: true },
    }),

  getStockSnapshot: (shopId: number) =>
    prisma.product.findMany({
      where: { shopId, isActive: true },
      select: {
        id: true,
        quantity: true,
        purchasePrice: true,
        alertThreshold: true,
        stockMovements: {
          where: { type: "ENTRY", unitCost: { not: null } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { unitCost: true },
        },
      },
    }),

  getSalesTimeline: async (
    shopId: number,
    period: AnalyticsPeriod,
    granularity: "hour" | "day" | "week" | "month",
  ) => {
    const bucket = Prisma.sql`date_trunc(${granularity}, "sales"."createdAt")`;
    return prisma.$queryRaw<
      Array<{
        bucket: Date;
        revenue: number | null;
        salesCount: bigint;
        remaining: number | null;
      }>
    >(Prisma.sql`
      SELECT
        ${bucket} AS bucket,
        COALESCE(SUM("sales"."totalAmount"), 0)::float AS revenue,
        COUNT(*) AS "salesCount",
        COALESCE(SUM("sales"."remaining"), 0)::float AS remaining
      FROM "sales"
      WHERE "sales"."shopId" = ${shopId}
        AND "sales"."createdAt" >= ${period.startDate}
        AND "sales"."createdAt" <= ${period.endDate}
      GROUP BY 1
      ORDER BY bucket ASC
    `);
  },

  getCollectedTimeline: async (
    shopId: number,
    period: AnalyticsPeriod,
    granularity: "hour" | "day" | "week" | "month",
  ) => {
    const bucket = Prisma.sql`date_trunc(${granularity}, "sale_payments"."paidAt")`;
    return prisma.$queryRaw<
      Array<{ bucket: Date; collected: number | null }>
    >(Prisma.sql`
      SELECT
        ${bucket} AS bucket,
        COALESCE(SUM("sale_payments"."amount"), 0)::float AS collected
      FROM "sale_payments"
      WHERE "saleId" IN (
        SELECT "id" FROM "sales" WHERE "shopId" = ${shopId}
      )
        AND "sale_payments"."paidAt" >= ${period.startDate}
        AND "sale_payments"."paidAt" <= ${period.endDate}
      GROUP BY 1
      ORDER BY bucket ASC
    `);
  },

  getTopProducts: (
    shopId: number,
    period: AnalyticsPeriod,
    limit: number,
    sort: "quantity" | "revenue",
  ) =>
    prisma.saleItem.groupBy({
      by: ["productId", "productName"],
      where: {
        sale: {
          shopId,
          createdAt: { gte: period.startDate, lte: period.endDate },
        },
      },
      _sum: { quantity: true, totalAmount: true },
      orderBy:
        sort === "quantity"
          ? { _sum: { quantity: "desc" } }
          : { _sum: { totalAmount: "desc" } },
      take: limit,
    }),
};
