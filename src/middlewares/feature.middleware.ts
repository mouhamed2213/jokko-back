import { NextFunction, Response } from "express";
import { AuthRequest } from "./auth.middleware.js";
import { SubscriptionService } from "../services/subscription.service.js";
import { ForbiddenError } from "../utils/errors.js";
import { FeatureCode } from "../database/prisma/generated/prisma/enums.js";

/**
 * Bloque l'accès à une route si le plan de l'utilisateur ne contient pas
 * le feature flag demandé (ADVANCED_REPORTS, MULTI_STORE, etc.).
 *
 * À utiliser en plus (jamais à la place) des vérifications côté frontend :
 * le frontend cache les fonctionnalités non incluses dans le plan, ce
 * middleware garantit qu'un appel direct à l'API ne peut pas les contourner.
 */
export const requireFeature =
  (featureCode: FeatureCode) =>
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const subscription = await SubscriptionService.currentSubscription(
        req.user!.shopId,
        req.user!.ownerId,
      );

      if (!subscription.features.includes(featureCode)) {
        throw new ForbiddenError(
          `Cette fonctionnalité nécessite un plan supérieur (${featureCode}).`,
        );
      }

      next();
    } catch (e) {
      next(e);
    }
  };
