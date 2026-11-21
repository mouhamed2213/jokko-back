import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { InvoiceService } from "./invoice.service.js";

export const getInvoices = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await InvoiceService.list(req.user!.shopId, {
      search: req.query.search as string | undefined,
      status: req.query.status as string | undefined,
      paymentMethod: req.query.paymentMethod as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getInvoiceById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const invoice = await InvoiceService.getById(
      req.user!.shopId,
      Number(req.params.id),
    );
    return res.status(200).json(invoice);
  } catch (error) {
    return next(error);
  }
};

export const addInvoicePayment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { amount, note, paymentMethod, payments } = req.body;
    const invoice = await InvoiceService.addPayment(
      req.user!.shopId,
      Number(req.params.id),
      amount,
      note,
      paymentMethod || "CASH",
      payments,
    );
    return res.status(200).json({
      message: "Paiement enregistré sur la facture",
      invoice,
    });
  } catch (error) {
    return next(error);
  }
};
