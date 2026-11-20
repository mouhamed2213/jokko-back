import { Response } from "express";
import { prisma } from "../config/prisma.js";
import { computeProfitMetrics } from "../helpers/profit.js";
import { AuthRequest } from "../middlewares/auth.middleware.js";
import { AnalyticsRepository } from "../modules/analytics/analytics.repository.js";
import { getCashTransactionCategory } from "../modules/analytics/analytics.service.js";

export const getDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const isAdmin = req.user!.role === "ADMIN";
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthPeriod = { startDate: startOfMonth, endDate: now };

    const [
      totalProducts,
      allProducts,
      totalClients,
      totalSuppliers,
      salesData,
      unpaidSales,
      supplierDebts,
      cashRegister,
      currentMonthSalesSum,
      currentMonthProfitSummary,
      currentMonthCashOutflows,
    ] = await Promise.all([
      prisma.product.count({ where: { shopId, isActive: true } }),
      prisma.product.findMany({
        where: { shopId, isActive: true },
        select: { quantity: true, alertThreshold: true, purchasePrice: true },
      }),
      prisma.client.count({ where: { shopId } }),
      prisma.supplier.count({ where: { shopId } }),
      prisma.sale.findMany({
        where: { shopId, status: { not: "CANCELLED" } },
        select: {
          totalAmount: true,
          paidAmount: true,
          remaining: true,
          createdAt: true,
        },
      }),
      prisma.sale.findMany({
        where: { shopId, status: { in: ["UNPAID", "PARTIAL"] } },
        select: { remaining: true },
      }),
      prisma.supplierDebt.findMany({
        where: { supplier: { shopId }, status: { in: ["UNPAID", "PARTIAL"] } },
        select: { remaining: true },
      }),
      prisma.cashRegister.findFirst({
        where: { shopId, status: "OPEN" },
      }),
      prisma.sale.aggregate({
        where: {
          shopId,
          status: { not: "CANCELLED" },
          createdAt: { gte: startOfMonth },
        },
        _sum: { totalAmount: true },
      }),
      isAdmin
        ? AnalyticsRepository.getProfitSummary(shopId, monthPeriod)
        : Promise.resolve(null),
      isAdmin
        ? AnalyticsRepository.getCashOutflows(shopId, monthPeriod)
        : Promise.resolve(null),
    ]);

    // --- CALCULS DES PRODUITS ---
    const lowStockProducts = allProducts.filter(
      (p) => p.quantity > 0 && p.quantity <= p.alertThreshold,
    ).length;
    const outOfStockProducts = allProducts.filter(
      (p) => p.quantity === 0,
    ).length;
    const stockValue = allProducts.reduce(
      (total, p) => total + p.quantity * p.purchasePrice,
      0,
    );

    // --- CALCULS DES VENTES ---
    const totalSalesAmount = salesData.reduce((sum, s) => sum + s.totalAmount, 0); // CA Global Historique
    const totalPaidAmount = salesData.reduce((sum, s) => sum + s.paidAmount, 0);
    const totalClientDebt = unpaidSales.reduce((sum, s) => sum + s.remaining, 0);
    const totalSupplierDebt = supplierDebts.reduce(
      (sum, d) => sum + d.remaining,
      0,
    );

    // --- AJOUT : Valeur finale du CA du mois en cours ---
    const currentMonthSalesAmount = currentMonthSalesSum._sum.totalAmount || 0;

    // Ventes des 7 derniers jours
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentSales = salesData.filter(s => new Date(s.createdAt) >= sevenDaysAgo);
    const recentSalesAmount = recentSales.reduce((sum, s) => sum + s.totalAmount, 0);

    // Produits les plus vendus (top 5, hors ventes annulées)
    const topProducts = await prisma.saleItem.groupBy({
      by: ["productId", "productName"],
      where: { sale: { shopId, status: { not: "CANCELLED" } } },
      _sum: { quantity: true, totalAmount: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    });

    const currentBalance = cashRegister ? cashRegister.openingAmount + cashRegister.totalIn - cashRegister.totalOut : null;

    const monthOperatingExpenses = (currentMonthCashOutflows ?? [])
      .filter((tx) => getCashTransactionCategory(tx.label) === "OTHER")
      .reduce((sum, tx) => sum + tx.amount, 0);

    const monthProfit =
      isAdmin && currentMonthProfitSummary
        ? computeProfitMetrics({
            revenue: currentMonthSalesAmount,
            costOfGoodsSold: currentMonthProfitSummary.costOfGoodsSold,
            operatingExpenses: monthOperatingExpenses,
          })
        : null;

    return res.status(200).json({
      totalProducts,
      lowStockProducts,
      outOfStockProducts,
      stockValue,
      totalSales: salesData.length,
      totalSalesAmount,
      currentMonthSalesAmount,
      ...(monthProfit && currentMonthProfitSummary
        ? {
            currentMonthCostOfGoodsSold: monthProfit.costOfGoodsSold,
            currentMonthGrossProfit: monthProfit.grossProfit,
            currentMonthMarginRate: monthProfit.marginRate,
            currentMonthOperatingExpenses: monthProfit.operatingExpenses,
            currentMonthNetProfit: monthProfit.netProfit,
            currentMonthItemsWithoutCost: currentMonthProfitSummary.itemsWithoutCost,
          }
        : {}),
      totalPaidAmount,
      totalClientDebt,
      recentSalesAmount,
      totalClients,
      totalSuppliers,
      totalSupplierDebt,
      cashOpen: cashRegister?.status === "OPEN",
      currentBalance,
      topProducts: topProducts.map((p) => ({
        productId: p.productId,
        productName: p.productName,
        totalQuantity: p._sum.quantity,
        totalAmount: p._sum.totalAmount,
      })),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Erreur récupération statistiques", error });
  }
};
