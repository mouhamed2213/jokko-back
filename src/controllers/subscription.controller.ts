import { NextFunction, Response } from "express";
import { logger } from "../config/logger.js";
import { AuthRequest } from "../middlewares/auth.middleware.js";
import { SubscriptionService } from "../services/subscription.service.js";
import { AppError, NotFoundError } from "../utils/errors.js";

export const SubscriptionController = {
  getCurrentSubs: async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const user = req?.user;

      if (!user) {
        throw new NotFoundError("Shop not found");
      }

      const subscription = await SubscriptionService.currentSubscription(
        user.shopId,
        user.ownerId,
      );

      return res.status(200).json({ message: "Subscription", subscription });
    } catch (e) {
      logger.error("Error while getting subscription", e);
      next(e);
    }
  },

  extendSubscription: async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { user } = req;
      const { extendedTo } = req.body;

      if (!user) {
        throw new AppError(
          "Impossible d'effectuer le prolongement : utilisateur ou boutique non trouvée",
        );
      }

      const subscription = await SubscriptionService.extendSubscription({
        shopId: user.shopId,
        shopOwnerId: user.ownerId,
        extendToDate: extendedTo,
      });

      logger.info(
        `📅 Abonnement prolongé — Shop: ${user.shopId} — Nouvelle date de fin: ${subscription.endDate}`,
      );

      return res.status(200).json({
        message: "Abonnement prolongé avec succès",
        subscription,
      });
    } catch (e) {
      logger.error("Erreur lors du prolongement de l'abonnement", e);
      next(e);
    }
  },
};
