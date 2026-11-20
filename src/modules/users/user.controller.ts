import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { UnauthorizedError } from "../../utils/errors.js";
import { UserService } from "./user.service.js";

export const getUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const users = await UserService.list(req.user!.shopId);
    return res.status(200).json(users);
  } catch (error) {
    return next(error);
  }
};

export const createUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const u = req.user;
    if (!u) {
      throw new UnauthorizedError("Token invalid ou à éxpiré");
    }
    const { name, email, password, role } = req.body;
    const user = await UserService.createUser(
      u.ownerId,
      u.shopId,
      name,
      email,
      password,
      role,
    );
    return res.status(201).json({
      message: "Utilisateur créé. Un email de vérification sera envoyé.",
      user,
    });
  } catch (error) {
    return next(error);
  }
};

export const updateUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const user = await UserService.update(
      req.user!.shopId,
      req.user!.userId,
      Number(req.params.id),
      req.body,
    );
    return res.status(200).json({ message: "Utilisateur modifié", user });
  } catch (error) {
    return next(error);
  }
};

export const deleteUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    await UserService.remove(
      req.user!.shopId,
      req.user!.userId,
      Number(req.params.id),
    );
    return res.status(200).json({ message: "Utilisateur supprimé" });
  } catch (error) {
    return next(error);
  }
};
