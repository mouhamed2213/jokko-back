import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { ForbiddenError } from "../../utils/errors.js";
import { ClientService } from "./client.service.js";

export const getClients = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await ClientService.list(req.user!.shopId, {
      search: String(req.query.search || ""),
      paginated: req.query.page !== undefined || req.query.limit !== undefined,
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 10,
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getClientById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await ClientService.getById(
      req.user!.shopId,
      Number(req.params.id),
      {
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 5,
        status: String(req.query.status || ""),
      },
    );
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const createClient = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = req.user;
    if (!user) {
      throw new ForbiddenError("Token invalide ou à éxpiré");
    }
    const { name, phone, email, address } = req.body;
    const client = await ClientService.createClient(
      user.ownerId,
      user.shopId,
      phone,
      email,
      name,
      address,
    );
    return res.status(201).json({ message: "Client créé avec succès", client });
  } catch (error) {
    return next(error);
  }
};

export const updateClient = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const client = await ClientService.update(
      req.user!.shopId,
      Number(req.params.id),
      req.body,
    );
    return res.status(200).json({ message: "Client modifié", client });
  } catch (error) {
    return next(error);
  }
};

export const deleteClient = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    await ClientService.remove(req.user!.shopId, Number(req.params.id));
    return res.status(200).json({ message: "Client supprimé" });
  } catch (error) {
    return next(error);
  }
};
