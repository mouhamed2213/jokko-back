import { Response } from "express";
import { prisma } from "../config/prisma.js";
import { AuthRequest } from "../middlewares/auth.middleware.js";

export const getDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    // const now = new Date();
    // const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

const now = new Date(); 
const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1); 
// startOfMonth vaudra automatiquement le 1er Juillet 2026

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
    ] = await Promise.all([
      prisma.product.count({ where: { shopId, isActive: true } }),
      prisma.product.findMany({
        where: { shopId, isActive: true },
        select: { quantity: true, alertThreshold: true, purchasePrice: true },
      }),
      prisma.client.count({ where: { shopId } }),
      prisma.supplier.count({ where: { shopId } }),
      prisma.sale.findMany({
        where: { shopId },
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
      // Requête ajoutée au Promise.all
      prisma.sale.aggregate({
        where: {
          shopId,
          createdAt: { gte: startOfMonth },
        },
        _sum: { totalAmount: true },
      }),
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

    // Produits les plus vendus (top 5)
    const topProducts = await prisma.saleItem.groupBy({
      by: ["productId", "productName"],
      where: { sale: { shopId } },
      _sum: { quantity: true, totalAmount: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    });

    const currentBalance = cashRegister ? cashRegister.openingAmount + cashRegister.totalIn - cashRegister.totalOut : null;

    return res.status(200).json({
      totalProducts,
      lowStockProducts,
      outOfStockProducts,
      stockValue,
      totalSales: salesData.length,
      totalSalesAmount,       // Reste le CA global
      currentMonthSalesAmount, // <-- AJOUT : Le frontend utilisera cette clé pour bloquer/flouter !
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
