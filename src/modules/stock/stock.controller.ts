import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { StockService } from "./stock.service.js";

export const addStockEntry = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await StockService.addEntry(
      req.user!.shopId,
      req.user!.userId,
      req.body,
    );
    return res.status(201).json({
      message: "Entrée de stock enregistrée",
      product: result.updatedProduct,
      movement: result.movement,
      debt: result.debt,
    });
  } catch (error) {
    return next(error);
  }
};

export const addStockOut = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { updatedProduct, movement } = await StockService.addOut(
      req.user!.shopId,
      req.user!.userId,
      req.body,
    );
    return res.status(201).json({
      message: "Sortie de stock enregistrée",
      product: updatedProduct,
      movement,
    });
  } catch (error) {
    return next(error);
  }
};

export const getStockMovements = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await StockService.listMovements(req.user!.shopId, {
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
      productId: req.query.productId ? Number(req.query.productId) : undefined,
      type: req.query.type as string | undefined,
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};
