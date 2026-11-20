import type { NextFunction, Request, Response } from "express";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { UnauthorizedError } from "../../utils/errors.js";
import { ShopService } from "./shop.service.js";

export const createShop = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const shop = await ShopService.registerPrimaryShop(req.body);
    return res
      .status(201)
      .json({ success: true, message: "Boutique créée avec succès", shop });
  } catch (error) {
    return next(error);
  }
};

export const createSecondShop = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError("Token invalide ou expiré");
    }
    const newShop = await ShopService.registerSecondaryShop(
      req.user.ownerId,
      req.user.userId,
      req.body,
    );
    return res
      .status(201)
      .json({ message: "Nouvelle boutique créee", newShop });
  } catch (error) {
    return next(error);
  }
};

export const getShops = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError("Accée non autorisé");
    }
    if (req.user.userId !== req.user.ownerId) {
      return res.status(200).json({ message: "Liste des boutiques", shops: [] });
    }
    const shops = await ShopService.getShops(req.user.ownerId);
    return res.status(200).json({ message: "Liste des boutiques", shops });
  } catch (error) {
    return next(error);
  }
};

export const switchShop = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.user || req.user.userId !== req.user.ownerId) {
      throw new UnauthorizedError(
        "Seul le propriétaire principal peut changer de boutique",
      );
    }
    const { token, user } = await ShopService.switchShop(
      req.user.ownerId,
      req.body,
    );
    return res
      .status(200)
      .json({ message: "Liste des boutiques", token, user });
  } catch (error) {
    return next(error);
  }
};

export const getShopSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const shop = await ShopService.getSettings(req.user!.shopId);
    return res.status(200).json(shop);
  } catch (error) {
    return next(error);
  }
};

export const updateShopSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const shop = await ShopService.updateSettings(
      req.user!.shopId,
      req.user!.ownerId,
      req.body,
    );
    return res.status(200).json({ message: "Paramètres mis à jour", shop });
  } catch (error) {
    return next(error);
  }
};

export const uploadShopLogo = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await ShopService.uploadLogo(req.user!.shopId, req.file);
    return res.status(200).json({
      message: "Logo uploadé avec succès",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};

export const deleteShopLogo = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    await ShopService.deleteLogo(req.user!.shopId);
    return res.status(200).json({ message: "Logo supprimé" });
  } catch (error) {
    return next(error);
  }
};
