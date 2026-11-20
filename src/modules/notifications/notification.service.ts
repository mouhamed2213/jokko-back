import type { Response } from "express";
import { prisma } from "../../config/prisma.js";

const clients = new Map<number, Set<Response>>();

export function sendNotificationToShop(
  shopId: number,
  event: string,
  data: object,
) {
  const shopClients = clients.get(shopId);
  if (!shopClients || shopClients.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  shopClients.forEach((client) => {
    try {
      client.write(payload);
    } catch {
      shopClients.delete(client);
    }
  });
}

export const NotificationService = {
  registerClient: (shopId: number, res: Response) => {
    if (!clients.has(shopId)) {
      clients.set(shopId, new Set());
    }
    clients.get(shopId)!.add(res);
    return clients.get(shopId)!.size;
  },

  unregisterClient: (shopId: number, res: Response) => {
    clients.get(shopId)?.delete(res);
    if (clients.get(shopId)?.size === 0) {
      clients.delete(shopId);
    }
  },

  getInitialStockAlerts: async (shopId: number) => {
    const allProducts = await prisma.product.findMany({
      where: { shopId, isActive: true },
      select: { id: true, name: true, quantity: true, alertThreshold: true },
    });
    const lowStock = allProducts.filter(
      (p) => p.quantity > 0 && p.quantity <= p.alertThreshold,
    );
    const outOfStock = allProducts.filter((p) => p.quantity === 0);
    return {
      lowStock,
      outOfStock,
      total: lowStock.length + outOfStock.length,
    };
  },

  getStockAlerts: async (shopId: number) => {
    const products = await prisma.product.findMany({
      where: { shopId, isActive: true },
      select: {
        id: true,
        name: true,
        quantity: true,
        alertThreshold: true,
        category: { select: { name: true } },
      },
    });
    const lowStock = products.filter(
      (p) => p.quantity > 0 && p.quantity <= p.alertThreshold,
    );
    const outOfStock = products.filter((p) => p.quantity === 0);
    return {
      lowStock,
      outOfStock,
      total: lowStock.length + outOfStock.length,
    };
  },
};
