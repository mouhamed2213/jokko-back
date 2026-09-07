import type { Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { AnalyticsService } from "./analytics.service.js";
import type { AnalyticsSalesQuery } from "./analytics.types.js";
import type { AnalyticsProductsQuery } from "./analytics.types.js";
import type { AnalyticsStockQuery } from "./analytics.types.js";
import type { AnalyticsCustomersQuery } from "./analytics.types.js";
import type { AnalyticsCashQuery } from "./analytics.types.js";

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

export const getProducts = async (req: AuthRequest, res: Response) => {
  const result = await AnalyticsService.getProducts(
    req.user!.shopId,
    req.query as AnalyticsProductsQuery,
  );
  return res.status(200).json(result);
};

export const getStock = async (req: AuthRequest, res: Response) => {
  const result = await AnalyticsService.getStock(
    req.user!.shopId,
    req.query as AnalyticsStockQuery,
  );
  return res.status(200).json(result);
};

export const getCustomers = async (req: AuthRequest, res: Response) => {
  const result = await AnalyticsService.getCustomers(
    req.user!.shopId,
    req.query as AnalyticsCustomersQuery,
  );
  return res.status(200).json(result);
};

export const getCash = async (req: AuthRequest, res: Response) => {
  const result = await AnalyticsService.getCash(
    req.user!.shopId,
    req.query as AnalyticsCashQuery,
  );
  return res.status(200).json(result);
};
