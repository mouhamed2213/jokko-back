import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { AnalyticsService } from "./analytics.service.js";
import type { AnalyticsSalesQuery } from "./analytics.types.js";

export const getOverview = async (req: AuthRequest, res: Response) => {
  const result = await AnalyticsService.getOverview(
    req.user!.shopId,
    {
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      compare: req.query.compare as string | undefined,
    },
  );
  return res.status(200).json(result);
};

export const getSales = async (req: AuthRequest, res: Response) => {
  const result = await AnalyticsService.getSales(
    req.user!.shopId,
    req.query as AnalyticsSalesQuery,
  );
  return res.status(200).json(result);
};
