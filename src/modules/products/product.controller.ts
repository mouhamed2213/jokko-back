import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { ProductService } from "./product.service.js";

export const getProducts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await ProductService.list(req.user!.shopId, {
      search: typeof req.query.search === "string" ? req.query.search : "",
      categoryId: req.query.categoryId
        ? Number(req.query.categoryId)
        : undefined,
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getProductById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const product = await ProductService.getById(
      req.user!.shopId,
      Number(req.params.id),
    );
    return res.status(200).json(product);
  } catch (error) {
    return next(error);
  }
};

export const createProduct = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const product = await ProductService.createFromRequest(
      req.user!.ownerId,
      req.user!.shopId,
      req.user!.userId,
      req.body,
      req.file,
    );
    return res
      .status(201)
      .json({ message: "Produit créé avec succès", product });
  } catch (error) {
    return next(error);
  }
};

export const updateProduct = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const product = await ProductService.update(
      req.user!.shopId,
      Number(req.params.id),
      req.body,
      req.file,
    );
    return res
      .status(200)
      .json({ message: "Produit modifié avec succès", product });
  } catch (error) {
    return next(error);
  }
};

export const deleteProduct = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    await ProductService.remove(req.user!.shopId, Number(req.params.id));
    return res.status(200).json({ message: "Produit supprimé avec succès" });
  } catch (error) {
    return next(error);
  }
};

export const getLowStockProducts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const lowStock = await ProductService.getLowStock(req.user!.shopId);
    return res.status(200).json(lowStock);
  } catch (error) {
    return next(error);
  }
};

export const getOutOfStockProducts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const outOfStock = await ProductService.getOutOfStock(req.user!.shopId);
    return res.status(200).json(outOfStock);
  } catch (error) {
    return next(error);
  }
};

export const getSuggestedPrice = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await ProductService.getSuggestedPrice(
      req.user!.shopId,
      Number(req.params.id),
      Number(req.query.quantity) || 1,
      req.query.unit as string | undefined,
    );
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};
