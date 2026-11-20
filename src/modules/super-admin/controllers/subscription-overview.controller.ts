import type { NextFunction, Request, Response } from "express";
import { SubscriptionLifecycleService, DEFAULT_GRACE_PERIOD_DAYS, MAX_GRACE_PERIOD_DAYS } from "../../subscriptions/subscription-lifecycle.service.js";
import { SubscriptionOverviewService } from "../services/subscription-overview.service.js";
import { BadRequestError } from "../../../utils/errors.js";

export const SubscriptionOverviewController = {
  list: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = req.query.page === undefined ? 1 : Number(req.query.page);
      const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
      if (!Number.isInteger(page) || page < 1) {
        throw new BadRequestError("Numéro de page invalide.");
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new BadRequestError("La limite doit être comprise entre 1 et 100.");
      }

      const result = await SubscriptionOverviewService.list({
        page,
        limit,
        q: req.query.q ? String(req.query.q) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
        plan: req.query.plan ? String(req.query.plan) : undefined,
      });
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },

  getGracePeriod: async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const days = await SubscriptionLifecycleService.getGracePeriodDays();
      return res.status(200).json({
        days,
        defaultDays: DEFAULT_GRACE_PERIOD_DAYS,
        maxDays: MAX_GRACE_PERIOD_DAYS,
      });
    } catch (error) {
      next(error);
    }
  },

  updateGracePeriod: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = Number(req.body?.days);
      if (
        !Number.isInteger(days) ||
        days < 0 ||
        days > MAX_GRACE_PERIOD_DAYS
      ) {
        throw new BadRequestError(
          `La durée doit être un entier compris entre 0 et ${MAX_GRACE_PERIOD_DAYS} jours.`,
        );
      }

      const settings = await SubscriptionLifecycleService.updateGracePeriodDays(days);
      return res.status(200).json({
        message: "Durée de grâce mise à jour.",
        ...settings,
      });
    } catch (error) {
      next(error);
    }
  },

  getStats: async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = await SubscriptionOverviewService.getOverviewStats();
      return res.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  },
};
