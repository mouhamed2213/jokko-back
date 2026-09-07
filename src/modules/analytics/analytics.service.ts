import { AnalyticsRepository } from "./analytics.repository.js";
import {
  isComparisonRequested,
  percentageChange,
  parseAnalyticsPeriod,
  roundMoney,
} from "./analytics.utils.js";
import type { AnalyticsPeriodQuery } from "./analytics.types.js";
import type { AnalyticsSalesQuery } from "./analytics.types.js";
import type { AnalyticsProductsQuery } from "./analytics.types.js";
import type { AnalyticsStockQuery } from "./analytics.types.js";
import type { AnalyticsCustomersQuery } from "./analytics.types.js";
import type { AnalyticsCashQuery } from "./analytics.types.js";
import { getSalesGranularity } from "./analytics.utils.js";
import {
  FAST_ROTATION_THRESHOLD,
  SLOW_ROTATION_THRESHOLD,
  getCustomerStatus,
  getProductSalesStatus,
} from "./analytics.utils.js";

export const AnalyticsService = {
  getOverview: async (
    shopId: number,
    query: AnalyticsPeriodQuery,
  ) => {
    const period = parseAnalyticsPeriod(query);
    const [sales, payments, previousSales, products] = await Promise.all([
      AnalyticsRepository.getSalesAggregate(shopId, period),
      AnalyticsRepository.getPaymentAggregate(shopId, period),
      AnalyticsRepository.getSalesAggregate(shopId, {
        ...period,
        startDate: period.previousStartDate,
        endDate: period.previousEndDate,
      }),
      AnalyticsRepository.getStockSnapshot(shopId),
    ]);

    const revenue = sales._sum.totalAmount || 0;
    const previousRevenue = previousSales._sum.totalAmount || 0;
    const stockValue = products.reduce(
      (total, product) =>
        total +
        product.quantity *
          (product.stockMovements[0]?.unitCost ?? product.purchasePrice),
      0,
    );

    return {
      period: {
        startDate: period.startDate,
        endDate: period.endDate,
      },
      comparison: isComparisonRequested(query.compare)
        ? { revenueChange: percentageChange(revenue, previousRevenue) }
        : null,
      kpis: {
        revenue: roundMoney(revenue),
        salesCount: sales._count._all,
        averageBasket:
          sales._count._all > 0
            ? roundMoney(revenue / sales._count._all)
            : 0,
        collected: roundMoney(payments._sum.amount || 0),
        receivables: roundMoney(sales._sum.remaining || 0),
        stockValue: roundMoney(stockValue),
        outOfStockProducts: products.filter((p) => p.quantity === 0).length,
        lowStockProducts: products.filter(
          (p) => p.quantity > 0 && p.quantity <= p.alertThreshold,
        ).length,
      },
    };
  },

  getSales: async (shopId: number, query: AnalyticsSalesQuery) => {
    const period = parseAnalyticsPeriod(query);
    const granularity = getSalesGranularity(period);
    const limit = Math.min(Math.max(Number(query.limit) || 5, 1), 20);
    const [timeline, collectedTimeline, topProductsByRevenue, topProductsByQuantity] =
      await Promise.all([
      AnalyticsRepository.getSalesTimeline(shopId, period, granularity),
      AnalyticsRepository.getCollectedTimeline(shopId, period, granularity),
      AnalyticsRepository.getTopProducts(shopId, period, limit, "revenue"),
      AnalyticsRepository.getTopProducts(shopId, period, limit, "quantity"),
    ]);
    const collectedByBucket = new Map(
      collectedTimeline.map((row) => [row.bucket.getTime(), row.collected || 0]),
    );

    return {
      period: { startDate: period.startDate, endDate: period.endDate },
      granularity,
      timeline: timeline.map((row) => ({
        bucket: row.bucket,
        revenue: roundMoney(row.revenue || 0),
        salesCount: Number(row.salesCount),
        collected: roundMoney(
          collectedByBucket.get(row.bucket.getTime()) || 0,
        ),
        remaining: roundMoney(row.remaining || 0),
      })),
      topProductsByRevenue: topProductsByRevenue.map((product) => ({
        productId: product.productId,
        productName: product.productName,
        quantity: product._sum.quantity || 0,
        revenue: roundMoney(product._sum.totalAmount || 0),
      })),
      topProductsByQuantity: topProductsByQuantity.map((product) => ({
          productId: product.productId,
          productName: product.productName,
          quantity: product._sum.quantity || 0,
          revenue: roundMoney(product._sum.totalAmount || 0),
        })),
    };
  },

  getProducts: async (shopId: number, query: AnalyticsProductsQuery) => {
    const period = parseAnalyticsPeriod(query);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
    const products = await AnalyticsRepository.getProductAnalytics(
      shopId,
      period,
      limit,
    );

    return {
      period: { startDate: period.startDate, endDate: period.endDate },
      costing: {
        method: "LATEST_ENTRY_BEFORE_SALE",
        estimatedWhenUnavailable: true,
      },
      products: products.map((product) => {
        const revenue = product.revenue || 0;
        const costOfGoodsSold = product.costOfGoodsSold || 0;
        const grossMargin = revenue - costOfGoodsSold;
        const rotationBase = product.soldQuantity + product.currentStock;
        const rotation =
          rotationBase > 0 ? product.soldQuantity / rotationBase : 0;

        return {
          productId: product.productId,
          productName: product.productName,
          createdAt: product.createdAt,
          soldQuantity: product.soldQuantity,
          revenue: roundMoney(revenue),
          costOfGoodsSold: roundMoney(costOfGoodsSold),
          grossMargin: roundMoney(grossMargin),
          marginRate:
            revenue > 0 ? roundMoney((grossMargin / revenue) * 100) : null,
          currentStock: product.currentStock,
          rotation: roundMoney(rotation),
          lastSaleAt: product.lastSaleAt,
          status: getProductSalesStatus(
            product.createdAt,
            product.lastSaleAt,
            period.endDate,
            rotation,
          ),
          costSource:
            product.estimatedQuantity > 0 ? "ESTIMATED" : "HISTORICAL",
          estimatedQuantity: product.estimatedQuantity,
          stockStatus:
            product.currentStock === 0
              ? "OUT_OF_STOCK"
              : product.currentStock <= product.alertThreshold
                ? "LOW_STOCK"
                : "IN_STOCK",
          rotationThresholds: {
            fast: FAST_ROTATION_THRESHOLD,
            slow: SLOW_ROTATION_THRESHOLD,
          },
        };
      }),
    };
  },

  getStock: async (shopId: number, query: AnalyticsStockQuery) => {
    const period = parseAnalyticsPeriod(query);
    const products = await AnalyticsRepository.getStockAnalytics(shopId, period);
    const productRows = products.map((product) => {
      const rotationBase = product.soldQuantity + product.currentStock;
      const rotation =
        rotationBase > 0 ? product.soldQuantity / rotationBase : 0;
      const status = getProductSalesStatus(
        product.createdAt,
        product.lastSaleAt,
        period.endDate,
        rotation,
      );
      const unitCost = product.unitCost ?? 0;

      return {
        productId: product.productId,
        productName: product.productName,
        currentStock: product.currentStock,
        unitCost: roundMoney(unitCost),
        stockValue: roundMoney(product.currentStock * unitCost),
        soldQuantity: product.soldQuantity,
        rotation: roundMoney(rotation),
        status,
        stockStatus:
          product.currentStock === 0
            ? "OUT_OF_STOCK"
            : product.currentStock <= product.alertThreshold
              ? "LOW_STOCK"
              : "IN_STOCK",
        lastSaleAt: product.lastSaleAt,
      };
    });
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

    return {
      period: { startDate: period.startDate, endDate: period.endDate },
      costing: {
        method: "LATEST_ENTRY_COST",
        missingCostTreatedAsZero: true,
      },
      summary: {
        totalStockValue: roundMoney(
          productRows.reduce((total, product) => total + product.stockValue, 0),
        ),
        productCount: productRows.length,
        outOfStock: productRows.filter(
          (product) => product.stockStatus === "OUT_OF_STOCK",
        ).length,
        lowStock: productRows.filter(
          (product) => product.stockStatus === "LOW_STOCK",
        ).length,
        fastRotation: productRows.filter(
          (product) => product.status === "FAST",
        ).length,
        slowRotation: productRows.filter(
          (product) => product.status === "SLOW",
        ).length,
        dormant: productRows.filter((product) => product.status === "DORMANT")
          .length,
        newProducts: productRows.filter((product) => product.status === "NEW")
          .length,
      },
      products: productRows.slice(0, limit),
    };
  },

  getCustomers: async (
    shopId: number,
    query: AnalyticsCustomersQuery,
  ) => {
    const period = parseAnalyticsPeriod(query);
    const customers = await AnalyticsRepository.getCustomerAnalytics(
      shopId,
      period,
    );
    const rows = customers.map((customer) => ({
      customerId: customer.customerId,
      customerName: customer.customerName,
      createdAt: customer.createdAt,
      purchasedAmount: roundMoney(customer.purchasedAmount || 0),
      orderCount: customer.orderCount,
      averageBasket:
        customer.orderCount > 0
          ? roundMoney(customer.purchasedAmount / customer.orderCount)
          : 0,
      receivable: roundMoney(customer.receivable || 0),
      lastOrderAt: customer.lastOrderAt,
      status: getCustomerStatus(
        customer.createdAt,
        customer.lastOrderAt,
        period.endDate,
      ),
      recurrent: customer.orderCount >= 2,
    }));
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

    return {
      period: { startDate: period.startDate, endDate: period.endDate },
      summary: {
        newCustomers: rows.filter((customer) => customer.status === "NEW")
          .length,
        activeCustomers: rows.filter(
          (customer) => customer.status === "ACTIVE",
        ).length,
        inactiveCustomers: rows.filter(
          (customer) => customer.status === "INACTIVE",
        ).length,
        recurrentCustomers: rows.filter((customer) => customer.recurrent)
          .length,
      },
      topCustomersByAmount: [...rows]
        .sort((a, b) => b.purchasedAmount - a.purchasedAmount)
        .slice(0, limit),
      topCustomersByOrders: [...rows]
        .sort((a, b) => b.orderCount - a.orderCount)
        .slice(0, limit),
      customers: rows.slice(0, limit),
    };
  },

  getCash: async (shopId: number, query: AnalyticsCashQuery) => {
    const period = parseAnalyticsPeriod(query);
    const [transactions, salePayments] = await Promise.all([
      AnalyticsRepository.getCashAnalytics(shopId, period),
      AnalyticsRepository.getPaymentAggregate(shopId, period),
    ]);
    const cashIn = transactions
      .filter((transaction) => transaction.type === "IN")
      .reduce((total, transaction) => total + transaction.amount, 0);
    const cashOut = transactions
      .filter((transaction) => transaction.type === "OUT")
      .reduce((total, transaction) => total + transaction.amount, 0);
    const collected = salePayments._sum.amount || 0;
    const byMethod = new Map<string, number>();

    transactions.forEach((transaction) => {
      byMethod.set(
        transaction.paymentMethod,
        (byMethod.get(transaction.paymentMethod) || 0) +
          (transaction.type === "IN" ? transaction.amount : -transaction.amount),
      );
    });

    return {
      period: { startDate: period.startDate, endDate: period.endDate },
      summary: {
        cashIn: roundMoney(cashIn),
        cashOut: roundMoney(cashOut),
        netCashFlow: roundMoney(cashIn - cashOut),
        commercialCollected: roundMoney(collected),
      },
      byPaymentMethod: [...byMethod.entries()].map(
        ([paymentMethod, amount]) => ({
          paymentMethod,
          amount: roundMoney(amount),
        }),
      ),
      transactions: transactions.map((transaction) => ({
        type: transaction.type,
        paymentMethod: transaction.paymentMethod,
        amount: roundMoney(transaction.amount),
        createdAt: transaction.createdAt,
        label: transaction.label,
      })),
    };
  },
};
