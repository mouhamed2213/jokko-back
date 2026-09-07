import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { SubscriptionService } from "../../services/subscription.service.js";
import { ForbiddenError } from "../../utils/errors.js";

export type AnalyticsSection =
  | "overview"
  | "sales"
  | "products"
  | "stock"
  | "customers"
  | "cash"
  | "trends"
  | "insights";

const minimumPlan: Record<AnalyticsSection, "FREE" | "BASIC" | "PRO"> = {
  overview: "FREE",
  sales: "FREE",
  stock: "FREE",
  cash: "FREE",
  products: "BASIC",
  customers: "BASIC",
  trends: "BASIC",
  insights: "PRO",
};

const planRank = { FREE: 0, BASIC: 1, PRO: 2, PREMIUM: 3 } as const;

export const requireAnalyticsAccess = (section: AnalyticsSection) =>
  async (req: AuthRequest, _res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) {
        throw new ForbiddenError("Accès Analytics non autorisé.");
      }

      const subscription = await SubscriptionService.currentSubscription(
        user.shopId,
        user.ownerId,
      );
      const required = minimumPlan[section];

      if (planRank[subscription.plan.code] < planRank[required]) {
        throw new ForbiddenError(
          `Cette analyse est disponible à partir du plan ${required}.`,
        );
      }

      if (
        section === "insights" &&
        !subscription.features.includes("ADVANCED_REPORTS")
      ) {
        throw new ForbiddenError(
          "Les insights automatiques nécessitent l'option Rapports avancés.",
        );
      }

      if (
        section === "overview" &&
        (req.query.compare === "true" || req.query.compare === "1") &&
        planRank[subscription.plan.code] < planRank.BASIC
      ) {
        throw new ForbiddenError(
          "La comparaison entre périodes est disponible à partir du plan BASIC.",
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };

export const requireMultiStoreAnalytics = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
) => {
  try {
  const user = req.user;
  if (!user) throw new ForbiddenError("Accès Analytics non autorisé.");

  const subscription = await SubscriptionService.currentSubscription(
    user.shopId,
    user.ownerId,
  );
  if (
    subscription.plan.code !== "PREMIUM" ||
    !subscription.features.includes("MULTI_STORE")
  ) {
    throw new ForbiddenError(
      "L'analyse multi-boutique nécessite le plan PREMIUM.",
    );
  }
  next();
  } catch (error) {
  next(error);
  }
};
