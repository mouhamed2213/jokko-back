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

  getProductAnalytics: (shopId: number, period: AnalyticsPeriod, limit: number) =>
    prisma.$queryRaw<
      Array<{
        productId: number;
        productName: string;
        createdAt: Date;
        currentStock: number;
        alertThreshold: number;
        soldQuantity: number;
        revenue: number;
        costOfGoodsSold: number;
        lastSaleAt: Date | null;
        estimatedQuantity: number;
      }>
    >(Prisma.sql`
      SELECT
        p."id" AS "productId",
        p."name" AS "productName",
        p."createdAt" AS "createdAt",
        p."quantity" AS "currentStock",
        p."alertThreshold" AS "alertThreshold",
        COALESCE(SUM(
          CASE WHEN s."id" IS NOT NULL THEN s_item."quantity" ELSE 0 END
        ), 0)::int AS "soldQuantity",
        COALESCE(SUM(
          CASE WHEN s."id" IS NOT NULL THEN s_item."totalAmount" ELSE 0 END
        ), 0)::float AS revenue,
        COALESCE(SUM(
          CASE WHEN s."id" IS NOT NULL
            THEN s_item."quantity" * COALESCE(cost."unitCost", p."purchasePrice")
            ELSE 0
          END
        ), 0)::float AS "costOfGoodsSold",
        MAX(s."createdAt") AS "lastSaleAt",
        COALESCE(SUM(
          CASE
            WHEN s_item."id" IS NOT NULL AND cost."unitCost" IS NULL
            THEN s_item."quantity"
            ELSE 0
          END
        ), 0)::int AS "estimatedQuantity"
      FROM "products" p
      LEFT JOIN "sale_items" s_item
        ON s_item."productId" = p."id"
      LEFT JOIN "sales" s
        ON s."id" = s_item."saleId"
        AND s."shopId" = p."shopId"
        AND s."createdAt" >= ${period.startDate}
        AND s."createdAt" <= ${period.endDate}
      LEFT JOIN LATERAL (
        SELECT sm."unitCost"
        FROM "stock_movements" sm
        WHERE sm."shopId" = p."shopId"
          AND sm."productId" = p."id"
          AND sm."type" = 'ENTRY'
          AND sm."unitCost" IS NOT NULL
          AND sm."createdAt" <= s."createdAt"
        ORDER BY sm."createdAt" DESC, sm."id" DESC
        LIMIT 1
      ) cost ON true
      WHERE p."shopId" = ${shopId}
        AND p."isActive" = true
      GROUP BY p."id", p."name", p."createdAt", p."quantity",
        p."alertThreshold", p."purchasePrice"
      ORDER BY revenue DESC, p."name" ASC
      LIMIT ${limit}
    `),
};
