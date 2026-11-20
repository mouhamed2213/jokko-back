import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { CashService } from "./cash.service.js";

export const openCash = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await CashService.open(
      req.user!.shopId,
      req.user!.userId,
      req.body?.openingAmount,
      req.body?.note,
    );
    if (result.alreadyOpen) {
      return res.status(400).json({
        message: "Une caisse est déjà ouverte",
        cashRegister: result.cashRegister,
      });
    }
    return res.status(201).json({
      message: "Caisse ouverte avec succès",
      cashRegister: result.cashRegister,
    });
  } catch (error) {
    return next(error);
  }
};

export const closeCash = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await CashService.close(
      req.user!.shopId,
      Number(req.params.id),
      req.body?.note,
    );
    return res.status(200).json({
      message: "Caisse fermée avec succès",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};

export const getCurrentCash = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await CashService.getCurrent(req.user!.shopId);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getCashHistory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await CashService.getHistory(
      req.user!.shopId,
      Number(req.query.page) || 1,
      Number(req.query.limit) || 15,
    );
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getCashById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await CashService.getById(
      req.user!.shopId,
      Number(req.params.id),
    );
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const addTransaction = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const transaction = await CashService.addTransaction(
      req.user!.shopId,
      req.body,
    );
    return res
      .status(201)
      .json({ message: "Transaction enregistrée", transaction });
  } catch (error) {
    return next(error);
  }
};
