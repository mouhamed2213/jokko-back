import type { NextFunction, Response } from "express";
import { logger } from "../../config/logger.js";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { AppError, NotFoundError } from "../../utils/errors.js";
import { SubscriptionService } from "./subscription.service.js";

export const SubscriptionController = {
  getCurrentSubs: async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = req.user;
      if (!user) {
        throw new NotFoundError("Shop not found");
      }
      const subscription = await SubscriptionService.currentSubscription(
        user.shopId,
        user.ownerId,
      );
      return res.status(200).json({ message: "Subscription", subscription });
    } catch (error) {
      logger.error("Error while getting subscription", error);
      return next(error);
    }
  },

  extendSubscription: async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = req.user;
      if (!user) {
        throw new AppError(
          "Impossible d'effectuer le prolongement : utilisateur ou boutique non trouvée",
        );
      }
      const subscription = await SubscriptionService.extendPrimarySubscription(
        user.shopId,
        user.userId,
        user.ownerId,
        req.body?.extendedTo,
      );
      logger.info(
        `📅 Abonnement prolongé — Shop: ${user.shopId} — Nouvelle date de fin: ${subscription.endDate}`,
      );
      return res.status(200).json({
        message: "Abonnement prolongé avec succès",
        subscription,
      });
    } catch (error) {
      logger.error("Erreur lors du prolongement de l'abonnement", error);
      return next(error);
    }
  },
};
