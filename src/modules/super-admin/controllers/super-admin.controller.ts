import { logger } from "../../../config/logger.js";
import { prisma } from "../../../config/prisma.js";
import { AuthRequest } from "../../../middlewares/auth.middleware.js";

import { NextFunction, Request, Response } from "express";
// import { BillingService } from "../services/billing.service.js";
import { SuperAdminShopService } from "../services/shop.service.js";
import { SubscriptionManagementService } from "../services/subscription-management.service.js";

export const SuperAdminShopController = {
  getStats: async (_req: Request, res: Response, next: NextFunction) => {
    try {
      // Total shops
      const totalShops = await prisma.shop.count();

      // Shops by status
      const shopsByStatusGroup = await prisma.shop.groupBy({
        by: ["status"],
        _count: { _all: true },
      });
      const shopsByStatus: Record<string, number> = {};
      shopsByStatusGroup.forEach((g: any) => {
        shopsByStatus[g.status] = g._count._all;
      });

      // Recent shops
      const recentShops = await prisma.shop.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          status: true,
        },
      });

      // Recent subscriptions (with plan & shop)
      const recentSubscriptions = await prisma.subscription.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          plan: { select: { code: true, name: true, price: true } },
          shop: { select: { id: true, name: true, email: true } },
        },
      });

      // Subscriptions group by status and by plan (plan code)
      const subsGroup = await prisma.subscription.groupBy({
        by: ["status", "planId"],
        _count: { _all: true },
      });

      // Fetch involved plans to map ids to codes
      const planIds = Array.from(new Set(subsGroup.map((s: any) => s.planId)));
      const plans =
        planIds.length > 0
          ? await prisma.plan.findMany({ where: { id: { in: planIds } } })
          : [];
      const planById: Record<number, any> = {};
      plans.forEach((p) => (planById[p.id] = p));

      const subscriptionsByStatus: Record<string, number> = {};
      const subscriptionsByPlan: Record<string, number> = {};

      subsGroup.forEach((g: any) => {
        const status = g.status;
        subscriptionsByStatus[status] =
          (subscriptionsByStatus[status] || 0) + g._count._all;

        const plan = planById[g.planId];
        const planCode = plan ? plan.code : String(g.planId);
        subscriptionsByPlan[planCode] =
          (subscriptionsByPlan[planCode] || 0) + g._count._all;
      });

      // MRR estimate: sum of plan.price for ACTIVE subscriptions (excluding FREE)
      const activeSubs = await prisma.subscription.findMany({
        where: { status: "ACTIVE" },
        include: { plan: { select: { code: true, price: true } } },
      });

      const mrr = activeSubs.reduce((acc, s) => {
        if (!s.plan || s.plan.code === "FREE") return acc;
        return acc + (s.plan.price || 0);
      }, 0);

      return res.status(200).json({
        totalShops,
        shopsByStatus,
        subscriptionsByStatus,
        subscriptionsByPlan,
        mrr,
        recentShops,
        recentSubscriptions,
      });
    } catch (error) {
      logger.error(error);
      return res
        .status(500)
        .json({ message: "Erreur récupération stats", error });
      next(error);
    }
  },

  // list shop
  listShops: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, limit, q, status, plan } = req.query;

      const result = await SuperAdminShopService.listShops({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        q: q ? String(q) : undefined,
        status: status ? String(status) : undefined,
        plan: plan ? String(plan) : undefined,
      });

      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  // shopp detail
  getShopDetail: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = Number(req.params.id);
      const result = await SuperAdminShopService.getShopDetail(shopId);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  // extendTrialPeriod
  subscription : async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { shop_id, planType } = req.body;
      const result = await SubscriptionManagementService.changePlan(
        shop_id,
        planType,
      );
      logger.info("New subscription");
      return res.status(200).json(result);
    } catch (e) {
      logger.warn(`Error cannot change subscription plan ${e}`);
      next(e);
    }
  },

  // extendTrialPeriod
updateSubscriptionStatus: async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shopId = Number(req.params.shopId);
    const { status } = req.body;
    const result = await SubscriptionManagementService.updateStatus(shopId, status);
    return res.status(200).json(result);
  } catch (e) {
      logger.warn(`Error, cannot change subscription Status ${e}`);

 
    next(e);
  }
},
  // extendTrialPeriod
  extendTrialPeriod: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const shopId = Number(req.params.shopId);
      const daysToAdd = Number(req.body?.daysToAdd);

      if (!Number.isInteger(shopId) || shopId <= 0) {
        throw new Error("Identifiant de boutique invalide");
      }

      if (!Number.isInteger(daysToAdd) || daysToAdd <= 0) {
        throw new Error("Le nombre de jours doit être un entier supérieur à 0");
      }

      const result = await SubscriptionManagementService.extendPeriod(
        shopId,
        daysToAdd,
      );

      logger.info(
        `Subscription extended — Shop: ${shopId} — Days: ${daysToAdd} — New end date: ${result.endDate}`,
      );

      return res.status(200).json({
        message: "Abonnement prolongé avec succès",
        subscription: result,
      });
    } catch (e) {
      logger.warn(`Error, cannot extend subscription ${e}`);
      next(e);
    }
  },
};
