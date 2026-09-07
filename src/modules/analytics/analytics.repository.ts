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

  getStockAnalytics: (shopId: number, period: AnalyticsPeriod) =>
    prisma.$queryRaw<
      Array<{
        productId: number;
        productName: string;
        createdAt: Date;
        currentStock: number;
        alertThreshold: number;
        unitCost: number | null;
        soldQuantity: number;
        lastSaleAt: Date | null;
      }>
    >(Prisma.sql`
      SELECT
        p."id" AS "productId",
        p."name" AS "productName",
        p."createdAt" AS "createdAt",
        p."quantity" AS "currentStock",
        p."alertThreshold" AS "alertThreshold",
        latest_cost."unitCost" AS "unitCost",
        COALESCE(SUM(
          CASE WHEN s."id" IS NOT NULL THEN s_item."quantity" ELSE 0 END
        ), 0)::int AS "soldQuantity",
        MAX(s."createdAt") AS "lastSaleAt"
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
        ORDER BY sm."createdAt" DESC, sm."id" DESC
        LIMIT 1
      ) latest_cost ON true
      WHERE p."shopId" = ${shopId}
        AND p."isActive" = true
      GROUP BY p."id", p."name", p."createdAt", p."quantity",
        p."alertThreshold", latest_cost."unitCost"
      ORDER BY p."name" ASC
    `),

  getCustomerAnalytics: (shopId: number, period: AnalyticsPeriod) =>
    prisma.$queryRaw<
      Array<{
        customerId: number;
        customerName: string;
        createdAt: Date;
        purchasedAmount: number;
        orderCount: number;
        receivable: number;
        lastOrderAt: Date | null;
      }>
    >(Prisma.sql`
      SELECT
        c."id" AS "customerId",
        c."name" AS "customerName",
        c."createdAt" AS "createdAt",
        COALESCE(SUM(
          CASE WHEN period_sale."id" IS NOT NULL
            THEN period_sale."totalAmount" ELSE 0 END
        ), 0)::float AS "purchasedAmount",
        COUNT(period_sale."id")::int AS "orderCount",
        COALESCE((
          SELECT SUM(all_sale."remaining")
          FROM "sales" all_sale
          WHERE all_sale."clientId" = c."id"
            AND all_sale."shopId" = c."shopId"
        ), 0)::float AS receivable,
        (
          SELECT MAX(all_sale."createdAt")
          FROM "sales" all_sale
          WHERE all_sale."clientId" = c."id"
            AND all_sale."shopId" = c."shopId"
        ) AS "lastOrderAt"
      FROM "clients" c
      LEFT JOIN "sales" period_sale
        ON period_sale."clientId" = c."id"
        AND period_sale."shopId" = c."shopId"
        AND period_sale."createdAt" >= ${period.startDate}
        AND period_sale."createdAt" <= ${period.endDate}
      WHERE c."shopId" = ${shopId}
      GROUP BY c."id", c."name", c."createdAt"
      ORDER BY "purchasedAmount" DESC, c."name" ASC
    `),

  getCashAnalytics: (shopId: number, period: AnalyticsPeriod) =>
    prisma.$queryRaw<
      Array<{
        type: string;
        paymentMethod: string;
        amount: number;
        createdAt: Date;
        label: string;
      }>
    >(Prisma.sql`
      SELECT
        ct."type" AS type,
        ct."paymentMethod" AS "paymentMethod",
        ct."amount" AS amount,
        ct."createdAt" AS "createdAt",
        ct."label" AS label
      FROM "cash_transactions" ct
      INNER JOIN "cash_registers" cr
        ON cr."id" = ct."cashRegisterId"
      WHERE cr."shopId" = ${shopId}
        AND ct."createdAt" >= ${period.startDate}
        AND ct."createdAt" <= ${period.endDate}
      ORDER BY ct."createdAt" ASC
    `),
};
