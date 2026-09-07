import { AnalyticsRepository } from "./analytics.repository.js";
import { BadRequestError } from "../../utils/errors.js";
import {
  isComparisonRequested,
  percentageChange,
  parseAnalyticsPeriod,
  roundMoney,
} from "./analytics.utils.js";

const getPagination = (
  query: { page?: string; pageSize?: string },
  fallbackSize = 20,
) => {
  const pageSize = Math.min(Math.max(Number(query.pageSize) || fallbackSize, 1), 100);
  const page = Math.max(Number(query.page) || 1, 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
};

const paginationMeta = (page: number, pageSize: number, total: number) => ({
  page,
  pageSize,
  total,
  totalPages: Math.max(Math.ceil(total / pageSize), 1),
});

const oneOf = (value: string | undefined, allowed: readonly string[], name: string) => {
  if (value && !allowed.includes(value)) {
    throw new BadRequestError(`Filtre ${name} invalide.`);
  }
  return value;
};
import type { AnalyticsPeriodQuery } from "./analytics.types.js";
import type { AnalyticsSalesQuery } from "./analytics.types.js";
import type { AnalyticsProductsQuery } from "./analytics.types.js";
import type { AnalyticsStockQuery } from "./analytics.types.js";
import type { AnalyticsCustomersQuery } from "./analytics.types.js";
import type { AnalyticsCashQuery } from "./analytics.types.js";
import type { AnalyticsTrendsQuery } from "./analytics.types.js";
import type { AnalyticsInsightsQuery } from "./analytics.types.js";
import { getSalesGranularity } from "./analytics.utils.js";
import {
  FAST_ROTATION_THRESHOLD,
  DORMANT_PRODUCT_DAYS,
  INSIGHT_CONCENTRATION_THRESHOLD,
  INSIGHT_REVENUE_CHANGE_THRESHOLD,
  SLOW_ROTATION_THRESHOLD,
  getCustomerStatus,
  getProductSalesStatus,
} from "./analytics.utils.js";

const getCashTransactionCategory = (label: string) => {
  if (label.startsWith("Règlement facture")) return "SALE_PAYMENT";
  if (label.startsWith("Acompte fournisseur")) return "SUPPLIER_DEPOSIT";
  if (label.startsWith("Paiement fournisseur")) return "SUPPLIER_PAYMENT";
  if (label.toLowerCase().includes("annulation")) return "PAYMENT_REVERSAL";
  return "OTHER";
};

const getCashTransactionTarget = (label: string, reference: string | null) => {
  const category = getCashTransactionCategory(label);
  if (category === "SALE_PAYMENT") {
    return { path: "/invoices", reference };
  }
  if (category === "SUPPLIER_DEPOSIT" || category === "SUPPLIER_PAYMENT") {
    return { path: "/suppliers", reference };
  }
  return null;
};

export const AnalyticsService = {
  getMultiStoreOverview: async (
    ownerId: number,
    query: AnalyticsPeriodQuery,
  ) => {
    const shops = await AnalyticsRepository.getAuthorizedShops(ownerId);
    const overviews = await Promise.all(
      shops.map(async ({ shopId, shop }) => ({
        shop: { id: shop.id, name: shop.name },
        overview: await AnalyticsService.getOverview(shopId, query),
      })),
    );
    const consolidated = overviews.reduce(
      (total, item) => ({
        revenue: total.revenue + item.overview.kpis.revenue,
        salesCount: total.salesCount + item.overview.kpis.salesCount,
        collected: total.collected + item.overview.kpis.collected,
        receivables: total.receivables + item.overview.kpis.receivables,
        stockValue: total.stockValue + item.overview.kpis.stockValue,
        outOfStockProducts:
          total.outOfStockProducts + item.overview.kpis.outOfStockProducts,
        lowStockProducts:
          total.lowStockProducts + item.overview.kpis.lowStockProducts,
      }),
      {
        revenue: 0,
        salesCount: 0,
        collected: 0,
        receivables: 0,
        stockValue: 0,
        outOfStockProducts: 0,
        lowStockProducts: 0,
      },
    );

    return {
      period: overviews[0]?.overview.period ?? null,
      shops: overviews,
      consolidated: {
        ...consolidated,
        averageBasket:
          consolidated.salesCount > 0
            ? roundMoney(consolidated.revenue / consolidated.salesCount)
            : 0,
      },
    };
  },

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
    const pagination = getPagination(query);
    const status = oneOf(query.status, ["NEW", "FAST", "SLOW", "REGULAR", "DORMANT"], "status");
    const stockStatus = oneOf(query.stockStatus, ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"], "stockStatus");
    const costSource = oneOf(query.costSource, ["HISTORICAL", "ESTIMATED"], "costSource");
    const products = await AnalyticsRepository.getProductAnalytics(shopId, period);

    const rows = products.map((product) => {
      const revenue = product.revenue || 0;
      const costOfGoodsSold = product.costOfGoodsSold || 0;
      const grossMargin = revenue - costOfGoodsSold;
      const rotationBase = product.soldQuantity + product.currentStock;
      const rotation = rotationBase > 0 ? product.soldQuantity / rotationBase : 0;
      return {
        productId: product.productId, productName: product.productName, createdAt: product.createdAt,
        soldQuantity: product.soldQuantity, revenue: roundMoney(revenue),
        costOfGoodsSold: roundMoney(costOfGoodsSold), grossMargin: roundMoney(grossMargin),
        marginRate: revenue > 0 ? roundMoney((grossMargin / revenue) * 100) : null,
        currentStock: product.currentStock, rotation: roundMoney(rotation), lastSaleAt: product.lastSaleAt,
        status: getProductSalesStatus(product.createdAt, product.lastSaleAt, period.endDate, rotation),
        costSource: product.estimatedQuantity > 0 ? "ESTIMATED" : "HISTORICAL",
        estimatedQuantity: product.estimatedQuantity,
        stockStatus: product.currentStock === 0 ? "OUT_OF_STOCK" : product.currentStock <= product.alertThreshold ? "LOW_STOCK" : "IN_STOCK",
        rotationThresholds: { fast: FAST_ROTATION_THRESHOLD, slow: SLOW_ROTATION_THRESHOLD },
      };
    }).filter((row) => (!status || row.status === status) && (!stockStatus || row.stockStatus === stockStatus) && (!costSource || row.costSource === costSource));
    const sortedRows = query.sort === "name" ? rows.sort((a, b) => a.productName.localeCompare(b.productName)) : rows;
    return {
      period: { startDate: period.startDate, endDate: period.endDate },
      pagination: paginationMeta(pagination.page, pagination.pageSize, sortedRows.length),
      costing: {
        method: "LATEST_ENTRY_BEFORE_SALE",
        estimatedWhenUnavailable: true,
      },
      products: sortedRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    };
  },

  getStock: async (shopId: number, query: AnalyticsStockQuery) => {
    const period = parseAnalyticsPeriod(query);
    const statusFilter = oneOf(query.status, ["NEW", "FAST", "SLOW", "REGULAR", "DORMANT"], "status");
    const stockStatusFilter = oneOf(query.stockStatus, ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"], "stockStatus");
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
    const pagination = getPagination(query);
    const filteredRows = productRows.filter((row) =>
      (!statusFilter || row.status === statusFilter) &&
      (!stockStatusFilter || row.stockStatus === stockStatusFilter),
    );

    return {
      period: { startDate: period.startDate, endDate: period.endDate },
      costing: {
        method: "LATEST_ENTRY_COST",
        missingCostTreatedAsZero: true,
      },
      summary: {
        totalStockValue: roundMoney(
          filteredRows.reduce((total, product) => total + product.stockValue, 0),
        ),
        productCount: filteredRows.length,
        outOfStock: filteredRows.filter(
          (product) => product.stockStatus === "OUT_OF_STOCK",
        ).length,
        lowStock: filteredRows.filter(
          (product) => product.stockStatus === "LOW_STOCK",
        ).length,
        fastRotation: filteredRows.filter(
          (product) => product.status === "FAST",
        ).length,
        slowRotation: filteredRows.filter(
          (product) => product.status === "SLOW",
        ).length,
        dormant: filteredRows.filter((product) => product.status === "DORMANT")
          .length,
        newProducts: filteredRows.filter((product) => product.status === "NEW")
          .length,
      },
      pagination: paginationMeta(pagination.page, pagination.pageSize, filteredRows.length),
      products: filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
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
    const pagination = getPagination(query);
    const statusFilter = oneOf(query.status, ["NEW", "ACTIVE", "INACTIVE"], "status");
    const recurrentFilter = oneOf(query.recurrent, ["true", "false"], "recurrent");
    const filteredRows = rows.filter((row) =>
      (!statusFilter || row.status === statusFilter) &&
      (!recurrentFilter || row.recurrent === (recurrentFilter === "true")),
    );

    return {
      period: { startDate: period.startDate, endDate: period.endDate },
      summary: {
        newCustomers: filteredRows.filter((customer) => customer.status === "NEW")
          .length,
        activeCustomers:         filteredRows.filter(
          (customer) => customer.status === "ACTIVE",
        ).length,
        inactiveCustomers:         filteredRows.filter(
          (customer) => customer.status === "INACTIVE",
        ).length,
        recurrentCustomers: filteredRows.filter((customer) => customer.recurrent)
          .length,
      },
      topCustomersByAmount: [...filteredRows]
        .sort((a, b) => b.purchasedAmount - a.purchasedAmount)
        .slice(pagination.offset, pagination.offset + pagination.pageSize),
      topCustomersByOrders: [...filteredRows]
        .sort((a, b) => b.orderCount - a.orderCount)
        .slice(pagination.offset, pagination.offset + pagination.pageSize),
      pagination: paginationMeta(pagination.page, pagination.pageSize, filteredRows.length),
      customers: filteredRows.slice(pagination.offset, pagination.offset + pagination.pageSize),
    };
  },

  getCash: async (shopId: number, query: AnalyticsCashQuery) => {
    const period = parseAnalyticsPeriod(query);
    const pagination = getPagination(query);
    const typeFilter = oneOf(query.type, ["IN", "OUT"], "type");
    const paymentMethodFilter = query.paymentMethod;
    const categoryFilter = query.category;
    const [transactions, salePayments] = await Promise.all([
      AnalyticsRepository.getCashAnalytics(shopId, period),
      AnalyticsRepository.getPaymentAggregate(shopId, period),
    ]);
    const filteredTransactions = transactions.filter((transaction) =>
      (!typeFilter || transaction.type === typeFilter) &&
      (!paymentMethodFilter || transaction.paymentMethod === paymentMethodFilter) &&
      (!categoryFilter || getCashTransactionCategory(transaction.label) === categoryFilter),
    );
    const cashIn = filteredTransactions
      .filter((transaction) => transaction.type === "IN")
      .reduce((total, transaction) => total + transaction.amount, 0);
    const cashOut = filteredTransactions
      .filter((transaction) => transaction.type === "OUT")
      .reduce((total, transaction) => total + transaction.amount, 0);
    const collected = salePayments._sum.amount || 0;
    const byMethod = new Map<string, number>();

    filteredTransactions.forEach((transaction) => {
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
      pagination: paginationMeta(pagination.page, pagination.pageSize, filteredTransactions.length),
      transactions: filteredTransactions.slice(pagination.offset, pagination.offset + pagination.pageSize).map((transaction) => ({
        type: transaction.type,
        paymentMethod: transaction.paymentMethod,
        amount: roundMoney(transaction.amount),
        createdAt: transaction.createdAt,
        label: transaction.label,
        reference: transaction.reference,
        category: getCashTransactionCategory(transaction.label),
        target: getCashTransactionTarget(transaction.label, transaction.reference),
      })),
    };
  },

  getTrends: async (shopId: number, query: AnalyticsTrendsQuery) => {
    const period = parseAnalyticsPeriod(query);
    const [weekly, collections, heatmap] = await Promise.all([
      AnalyticsRepository.getWeeklyTrends(shopId, period),
      AnalyticsRepository.getWeeklyCollections(shopId, period),
      AnalyticsRepository.getActivityHeatmap(shopId, period),
    ]);
    const names = [
      "Lundi",
      "Mardi",
      "Mercredi",
      "Jeudi",
      "Vendredi",
      "Samedi",
      "Dimanche",
    ];
    const collectedByDay = new Map(
      collections.map((row) => [row.weekday, row.collected || 0]),
    );
    const days = weekly.map((row) => ({
      weekday: row.weekday,
      day: names[row.weekday - 1],
      revenue: roundMoney(row.revenue || 0),
      salesCount: row.salesCount,
      collected: roundMoney(collectedByDay.get(row.weekday) || 0),
      quantitySold: row.quantitySold || 0,
      averageBasket:
        row.salesCount > 0 ? roundMoney((row.revenue || 0) / row.salesCount) : 0,
    }));

    return {
      period: { startDate: period.startDate, endDate: period.endDate },
      byWeekday: days,
      mostActiveDay:
        [...days].sort((a, b) => b.salesCount - a.salesCount)[0] || null,
      topRevenueDay:
        [...days].sort((a, b) => b.revenue - a.revenue)[0] || null,
      heatmap: heatmap.map((row) => ({
        weekday: row.weekday,
        day: names[row.weekday - 1],
        hour: row.hour,
        salesCount: row.salesCount,
      })),
    };
  },

  getInsights: async (shopId: number, query: AnalyticsInsightsQuery) => {
    const period = parseAnalyticsPeriod(query);
    const pagination = getPagination(query, 10);
    const insightType = oneOf(query.type, [
      "REVENUE_GROWTH", "REVENUE_DECLINE", "OUT_OF_STOCK", "LOW_STOCK",
      "DORMANT_PRODUCTS", "SALES_CONCENTRATION", "RECEIVABLES",
    ], "type");
    const insightSeverity = oneOf(query.severity, ["POSITIVE", "INFO", "WARNING"], "severity");
    const [overview, products, currentSales, previousSales] =
      await Promise.all([
        AnalyticsService.getOverview(shopId, query),
        AnalyticsService.getProducts(shopId, {
          ...query,
          limit: "200",
          page: "1",
          pageSize: "100",
        }),
        AnalyticsRepository.getSalesAggregate(shopId, period),
        AnalyticsRepository.getSalesAggregate(shopId, {
          ...period,
          startDate: period.previousStartDate,
          endDate: period.previousEndDate,
        }),
      ]);
    const insights: Array<{
      type: string;
      severity: "POSITIVE" | "INFO" | "WARNING";
      message: string;
      value?: number;
      context: Record<string, unknown>;
    }> = [];
    const revenue = overview.kpis.revenue;
    const previousRevenue = previousSales._sum.totalAmount || 0;
    const revenueChange = percentageChange(revenue, previousRevenue);

    if (
      revenueChange !== null &&
      currentSales._count._all > 0 &&
      Math.abs(revenueChange) >= INSIGHT_REVENUE_CHANGE_THRESHOLD
    ) {
      insights.push({
        type: revenueChange > 0 ? "REVENUE_GROWTH" : "REVENUE_DECLINE",
        severity: revenueChange > 0 ? "POSITIVE" : "WARNING",
        message:
          revenueChange > 0
            ? `Votre chiffre d'affaires est supérieur de ${revenueChange}% à celui de la période précédente.`
            : `Votre chiffre d'affaires est inférieur de ${Math.abs(revenueChange)}% à celui de la période précédente.`,
        value: revenueChange,
        context: { previousRevenue: roundMoney(previousRevenue) },
      });
    }

    if (overview.kpis.outOfStockProducts > 0) {
      insights.push({
        type: "OUT_OF_STOCK",
        severity: "WARNING",
        message: `${overview.kpis.outOfStockProducts} produit(s) sont en rupture de stock.`,
        value: overview.kpis.outOfStockProducts,
        context: {},
      });
    }
    if (overview.kpis.lowStockProducts > 0) {
      insights.push({
        type: "LOW_STOCK",
        severity: "WARNING",
        message: `${overview.kpis.lowStockProducts} produit(s) sont sous leur seuil d'alerte.`,
        value: overview.kpis.lowStockProducts,
        context: {},
      });
    }

    const dormantProducts = products.products.filter(
      (product) => product.status === "DORMANT",
    ).length;
    if (dormantProducts > 0) {
      insights.push({
        type: "DORMANT_PRODUCTS",
        severity: "INFO",
        message: `${dormantProducts} produit(s) n'ont enregistré aucune vente récente.`,
        value: dormantProducts,
        context: { dormantDays: DORMANT_PRODUCT_DAYS },
      });
    }

    const topFiveRevenue = products.products
      .slice(0, 5)
      .reduce((total, product) => total + product.revenue, 0);
    const concentration =
      revenue > 0 ? roundMoney((topFiveRevenue / revenue) * 100) : null;
    if (
      concentration !== null &&
      products.products.length > 5 &&
      concentration >= INSIGHT_CONCENTRATION_THRESHOLD
    ) {
      insights.push({
        type: "SALES_CONCENTRATION",
        severity: "INFO",
        message: `Les 5 meilleurs produits représentent ${concentration}% de votre chiffre d'affaires.`,
        value: concentration,
        context: {
          productCount: 5,
          products: products.products.slice(0, 5).map((product) => ({
            productId: product.productId,
            productName: product.productName,
            revenue: product.revenue,
          })),
        },
      });
    }

    if (overview.kpis.receivables > 0) {
      insights.push({
        type: "RECEIVABLES",
        severity: "WARNING",
        message: `${overview.kpis.receivables} FCFA restent à encaisser.`,
        value: overview.kpis.receivables,
        context: {},
      });
    }

    const filteredInsights = insights.filter((insight) =>
      (!insightType || insight.type === insightType) &&
      (!insightSeverity || insight.severity === insightSeverity),
    );
    return {
      period: { startDate: period.startDate, endDate: period.endDate },
      thresholds: {
        revenueChangePercentage: INSIGHT_REVENUE_CHANGE_THRESHOLD,
        concentrationPercentage: INSIGHT_CONCENTRATION_THRESHOLD,
        dormantDays: DORMANT_PRODUCT_DAYS,
      },
      pagination: paginationMeta(pagination.page, pagination.pageSize, filteredInsights.length),
      insights: filteredInsights.slice(pagination.offset, pagination.offset + pagination.pageSize),
    };
  },
};
