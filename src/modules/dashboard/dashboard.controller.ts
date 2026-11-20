import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { DashboardService } from "./dashboard.service.js";

export const getDashboardStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const stats = await DashboardService.getStats(
      req.user!.shopId,
      req.user!.role === "ADMIN",
    );
    return res.status(200).json(stats);
  } catch (error) {
    return next(error);
  }
};
