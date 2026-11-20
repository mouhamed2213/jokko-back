import { logger } from "../../../config/logger.js";
import { AuthRequest } from "../../../middlewares/auth.middleware.js";

import { NextFunction, Request, Response } from "express";
import { SuperAdminShopService } from "../services/shop.service.js";
import { ShopArchiveService } from "../services/shop-archive.service.js";
import { SuperAdminOwnerService } from "../services/owner.service.js";
import { SuperAdminDashboardService } from "../services/dashboard-stats.service.js";
import { getAuditActor } from "../../../helpers/audit-logger.js";
import { BadRequestError } from "../../../utils/errors.js";
import { SubscriptionManagementService } from "../services/subscription-management.service.js";

export const SuperAdminShopController = {
  me: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const admin = await SuperAdminDashboardService.getAdminProfile(
        req.user!.userId,
      );
      if (!admin) {
        return res.status(401).json({ message: "Session Super Admin invalide" });
      }
      return res.status(200).json({ ...admin, role: "SUPER_ADMIN" });
    } catch (error) {
      return next(error);
    }
  },

  getStats: async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await SuperAdminDashboardService.getPlatformStats();
      return res.status(200).json(stats);
    } catch (error) {
      logger.error(error);
      return next(error);
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

  // Propriétaires : liste et vue globale du réseau de boutiques
  listOwners: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, limit, q } = req.query;
      const result = await SuperAdminOwnerService.listOwners({
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        q: q ? String(q) : undefined,
      });
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  getOwnerDetail: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = Number(req.params.id);
      if (!Number.isInteger(userId) || userId <= 0) {
        throw new BadRequestError("Identifiant de propriétaire invalide");
      }
      const result = await SuperAdminOwnerService.getOwnerDetail(userId);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  // Archiver une boutique (réversible, aucune donnée supprimée)
  archiveShop: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const shopId = Number(req.params.id);
      if (!Number.isInteger(shopId) || shopId <= 0) {
        throw new BadRequestError("Identifiant de boutique invalide");
      }
      const shop = await ShopArchiveService.archive(shopId, getAuditActor(req));
      return res.status(200).json({ message: "Boutique archivée", shop });
    } catch (error) {
      next(error);
    }
  },

  // Restaurer une boutique archivée
  restoreShop: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const shopId = Number(req.params.id);
      if (!Number.isInteger(shopId) || shopId <= 0) {
        throw new BadRequestError("Identifiant de boutique invalide");
      }
      const shop = await ShopArchiveService.restore(shopId, getAuditActor(req));
      return res.status(200).json({ message: "Boutique restaurée", shop });
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
  subscription: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { shop_id, planType, provider, amount, transactionReference } = req.body ?? {};
      const result = await SubscriptionManagementService.changePlan({
        shopId: Number(shop_id),
        planCode: planType,
        provider,
        amount: amount === undefined ? undefined : Number(amount),
        transactionReference,
      });
      logger.info("Subscription plan change requested", { shopId: Number(shop_id), planType, paymentId: result.payment?.id });
      return res.status(201).json(result);
    } catch (e) {
      logger.warn(`Error cannot change subscription plan ${e}`);
      next(e);
    }
  },

  confirmSubscriptionPayment: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const paymentId = Number(req.params.paymentId);
      const result = await SubscriptionManagementService.confirmPayment(paymentId, {
        actorId: req.user!.userId,
        actorName: req.user!.email,
      });
      return res.status(200).json({ message: "Paiement confirmé et abonnement activé", ...result });
    } catch (e) {
      logger.warn(`Error cannot confirm subscription payment ${e}`);
      next(e);
    }
  },

  cancelSubscriptionPayment: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const paymentId = Number(req.params.paymentId);
      const payment = await SubscriptionManagementService.cancelPendingPayment(paymentId, {
        actorId: req.user!.userId,
        actorName: req.user!.email,
      });
      return res.status(200).json({ message: "Paiement en attente annulé", payment });
    } catch (e) {
      logger.warn(`Error cannot cancel subscription payment ${e}`);
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
