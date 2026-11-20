import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { BadRequestError, UnauthorizedError } from "../../utils/errors.js";
import { SaleService } from "./sale.service.js";

export const getSales = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await SaleService.list(req.user!.shopId, {
      status: req.query.status as string | undefined,
      clientId: req.query.clientId ? Number(req.query.clientId) : undefined,
      search: req.query.search as string | undefined,
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getSaleById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const sale = await SaleService.getById(
      req.user!.shopId,
      Number(req.params.id),
    );
    return res.status(200).json(sale);
  } catch (error) {
    return next(error);
  }
};

export const createSale = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user;
    if (!user) {
      throw new UnauthorizedError("Token invalide ou expiré");
    }

    const { clientId, customerName, paidAmount, note, items, paymentMethod } =
      req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new BadRequestError("Au moins un article est requis");
    }
    if (!clientId && !customerName?.trim()) {
      throw new BadRequestError("Client ou nom du client passager requis");
    }

    const sale = await SaleService.createSale(
      user.ownerId,
      user.shopId,
      user.userId,
      user.role,
      clientId,
      customerName,
      paidAmount,
      paymentMethod,
      items,
      note,
    );

    return res
      .status(201)
      .json({ message: "Vente enregistrée avec succès", sale });
  } catch (error) {
    return next(error);
  }
};

export const updateSale = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { clientId, customerName, items, note } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new BadRequestError("Au moins un article est requis");
    }

    const sale = await SaleService.updateSale(
      req.user!.shopId,
      req.user!.userId,
      Number(req.params.id),
      clientId,
      customerName,
      items,
      note,
    );

    return res
      .status(200)
      .json({ message: "Facture modifiée avec succès", sale });
  } catch (error) {
    return next(error);
  }
};

export const addSalePayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { amount, note, paymentMethod } = req.body;
    const sale = await SaleService.addPayment(
      req.user!.shopId,
      Number(req.params.id),
      Number(amount),
      note,
      paymentMethod || "CASH",
    );
    return res
      .status(200)
      .json({ message: "Paiement ajouté avec succès", sale });
  } catch (error) {
    return next(error);
  }
};

export const deleteSale = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const cancelled = await SaleService.cancelSale(
      req.user!.shopId,
      req.user!.userId,
      Number(req.params.id),
    );
    return res.status(200).json({
      message: "Vente annulée et stock restauré",
      sale: cancelled,
    });
  } catch (error) {
    return next(error);
  }
};
