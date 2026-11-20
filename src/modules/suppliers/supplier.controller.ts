import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { SupplierService } from "./supplier.service.js";

export const getSuppliers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await SupplierService.list(req.user!.shopId, {
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 10,
      agingBucket:
        typeof req.query.agingBucket === "string"
          ? req.query.agingBucket
          : undefined,
      search: typeof req.query.search === "string" ? req.query.search : "",
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getSupplierById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await SupplierService.getById(
      req.user!.shopId,
      Number(req.params.id),
      Number(req.query.page) || 1,
      Number(req.query.limit) || 10,
    );
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getSupplierProducts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await SupplierService.getProducts(
      req.user!.shopId,
      Number(req.query.supplierId),
    );
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getSupplierRanking = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await SupplierService.getRanking(
      req.user!.shopId,
      typeof req.query.sortBy === "string" ? req.query.sortBy : "purchases",
      Number(req.query.page) || 1,
      Number(req.query.limit) || 10,
    );
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getConsolidatedSuppliers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await SupplierService.getConsolidated(
      req.user!.userId,
      req.user!.ownerId,
    );
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const createSupplier = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const supplier = await SupplierService.create(
      req.user!.shopId,
      req.user!.ownerId,
      req.body,
    );
    return res
      .status(201)
      .json({ message: "Fournisseur créé avec succès", supplier });
  } catch (error) {
    return next(error);
  }
};

export const getSupplierQuota = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await SupplierService.getQuota(
      req.user!.shopId,
      req.user!.ownerId,
    );
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getSupplierDebtAging = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await SupplierService.getDebtAging(req.user!.shopId);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const updateSupplier = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const supplier = await SupplierService.update(
      req.user!.shopId,
      Number(req.params.id),
      req.body,
    );
    return res.status(200).json({ message: "Fournisseur modifié", supplier });
  } catch (error) {
    return next(error);
  }
};

export const deleteSupplier = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    await SupplierService.remove(req.user!.shopId, Number(req.params.id));
    return res.status(200).json({ message: "Fournisseur supprimé" });
  } catch (error) {
    return next(error);
  }
};

export const addSupplierDebt = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const debt = await SupplierService.addDebt(
      req.user!.shopId,
      Number(req.params.id),
      req.body,
    );
    return res.status(201).json({ message: "Dette enregistrée", debt });
  } catch (error) {
    return next(error);
  }
};

export const addSupplierPayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await SupplierService.addPayment(
      req.user!.shopId,
      Number(req.params.id),
      Number(req.params.debtId),
      req.body,
    );
    return res.status(201).json({
      message: "Paiement enregistré",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};
