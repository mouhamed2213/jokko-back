import type { NextFunction, Request, Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { AuthService } from "./auth.service.js";

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await AuthService.login(req.body?.email, req.body?.password);
    return res.status(200).json({ message: "Connexion réussie", ...result });
  } catch (error) {
    return next(error);
  }
};

export const loginSuperAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await AuthService.loginSuperAdmin(
      req.body?.email,
      req.body?.password,
    );
    return res
      .status(200)
      .json({ message: "Connexion Super Admin réussie", ...result });
  } catch (error) {
    return next(error);
  }
};

export const me = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const data = await AuthService.getMe(req.user!.userId, req.user!.shopId);
    return res.status(200).json({ message: "ok", me: data });
  } catch (error) {
    return next(error);
  }
};
