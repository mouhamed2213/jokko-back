import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { CategoryService } from "./category.service.js";

export const getCategories = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const categories = await CategoryService.list(req.user!.shopId);
    return res.status(200).json(categories);
  } catch (error) {
    return next(error);
  }
};

export const createCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const category = await CategoryService.create(
      req.user!.shopId,
      req.body?.name,
    );
    return res.status(201).json({ message: "Catégorie créée", category });
  } catch (error) {
    return next(error);
  }
};

export const deleteCategory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    await CategoryService.remove(req.user!.shopId, Number(req.params.id));
    return res.status(200).json({ message: "Catégorie supprimée" });
  } catch (error) {
    return next(error);
  }
};
