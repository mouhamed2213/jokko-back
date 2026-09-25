import bcrypt from "bcrypt";
import type { NextFunction, Request } from "express";
import { Response } from "express";

import { logger } from "../config/logger.js";
import { prisma } from "../config/prisma.js";
import { AuthRequest } from "../middlewares/auth.middleware.js";
import { ShopService } from "../services/shop.service.js";
import { UnauthorizedError } from "../utils/errors.js";
import {   UploadService } from "../modules/uploads/upload.service.js";
import {
  cleanPath,
  getFullStorageUrl,
  validateFile,
} from "../utils/file-upload.js";
import { LOGO_BUCKET } from "../config/storage.config.js";

// Create seconday shop
export const createSecondShop = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { user } = req;
    const { password, ...shopData } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const shopPayload = {
      ...shopData,
      password: hashedPassword,
    };

    if (!user) {
      throw new UnauthorizedError("Token invalid ou à éxpiré");
    }

    const newShop = await ShopService.createSecondaryShop(
      user?.ownerId,
      user?.userId, // actor
      shopPayload,
    );

    logger.warn(`User ${user.userId}  has created a new shop`);

    return res
      .status(201)
      .json({ message: "Nouvelle boutique créee", newShop });
  } catch (e) {
    logger.warn("Error while creating second shop");
    next(e);
  }
};

// getShops

export const getShops = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { user } = req;
    if (!user) {
      throw new UnauthorizedError("Accée non autorisé");
    }

    const shops = await ShopService.getShops(user?.ownerId);
    return res.status(200).json({ message: "Liste des boutiques", shops });
  } catch (e) {
    logger.warn("Cannot get shops");
    next(e);
  }
};

// switch to secondary shop
export const switchShop = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const shopData = req.body;
    const ownerId = req.user?.ownerId;
    const { token, user } = await ShopService.switchShop(
      ownerId as number,
      shopData,
    );

    return res
      .status(200)
      .json({ message: "Liste des boutiques", token, user });
  } catch (e) {
    logger.warn("Error while switching to shops");
    next(e);
  }
};

export const createShop = async (req: Request, res: Response) => {
  try {
    const {
      shopName,
      ownerName,
      email,
      phone,
      address,
      adminPassword,
      currentShop,
      planType,
      onwnerId,
    } = req.body;

    if (!shopName || !ownerName || !email || !adminPassword || !planType) {
      return res.status(400).json({ message: "Champs obligatoires manquants" });
    }

    const existingShop = await ShopService.find(email);
    if (existingShop && currentShop === "PRIMARY") {
      return res
        .status(400)
        .json({ message: "Une boutique avec cet email existe déjà" });
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    const shop = await ShopService.createShop(
      shopName,
      ownerName,
      email,
      phone,
      address,
      hashedPassword,
      planType,
    );

    logger.info(`🏪 Nouvelle boutique créée — "${shopName}" — Email: ${email}`);
    return res
      .status(201)
      .json({ success: true, message: "Boutique créée avec succès", shop });
  } catch (error) {
    return res.status(500).json({ message: "Erreur création boutique", error });
  }
};

// ── GET /shop/settings ────────────────────────────────────────
export const getShopSettings = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;

    const shopData = await prisma.shop.findUnique({
      where: { id: shopId },
      include: {
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            plan: true,
          },
        },
        _count: {
          select: { users: true, products: true, sales: true, clients: true },
        },
      },
    });

    const shop = {
      ...shopData,
      logoUrl: getFullStorageUrl(LOGO_BUCKET, shopData?.logoUrl as string),
    };

    if (!shop) return res.status(404).json({ message: "Boutique introuvable" });

    return res.status(200).json(shop);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur récupération paramètres", error });
  }
};

// ── PUT /shop/settings ────────────────────────────────────────
export const updateShopSettings = async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user;
    const { name, ownerName, phone, address } = req.body;

    if (!name || !ownerName || !phone) {
      return res.status(400).json({
        message: "Nom boutique et nom propriétaire et le numéro  obligatoires ",
      });
    }

    const shop = prisma.$transaction(async (tx) => {
      const res = await tx.shop.update({
        where: { id: user?.shopId },
        data: {
          name: name.trim(),
          ownerName: ownerName.trim(),
          phone: phone.trim(),
          address: address?.trim() || null,
        },
      });

      await tx.shopOwner.updateMany({
        where: { shopId: user?.shopId, userId: user?.ownerId },
        data: {
          phone: res.phone,
        },
      });
    });

    return res.status(200).json({ message: "Paramètres mis à jour", shop });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur mise à jour paramètres", error });
  }
};

// ── POST /shop/logo ───────────────────────────────────────────
export const uploadShopLogo = async (req: AuthRequest, res: Response) => {
  const userId = req.user?.userId;
  if (!req.file) {
    return res.status(400).json({ message: "Aucun fichier reçu" });
  }
  const file = req.file;

  validateFile(file);
  const generatePath = cleanPath(file);

  const logoPath = await UploadService.uploadFile(file, generatePath, "logo");

  // Mettre à jour le logo en base
  prisma.shop
    .update({
      where: { id: req.user!.shopId },
      data: { logoUrl: logoPath.path },
    })
    .then((shop) => {
      return res.status(200).json({
        message: "Logo uploadé avec succès",
        generatePath,
        shop,
      });
    })
    .catch((error) => {
      return res.status(500).json({ message: "Erreur sauvegarde logo", error });
    });
};

// ── DELETE /shop/logo ─────────────────────────────────────────
export const deleteShopLogo = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;

    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { logoUrl: true },
    });
    if (!shop) return res.status(404).json({ message: "Boutique introuvable" });

    const data = await UploadService.deleteFile(
      LOGO_BUCKET,
      shop.logoUrl ?? "",
    );

    // Optionnel : Avertir si rien n'a été trouvé
    if (!data || data.length === 0) {
      logger.warn(
        `Aucun fichier trouvé à supprimer dans '${LOGO_BUCKET}' au chemin : ${shop.logoUrl}`,
      );
    }

    await prisma.shop.update({
      where: { id: shopId },
      data: { logoUrl: null },
    });

    return res.status(200).json({ message: "Logo supprimé" });
  } catch (error) {
    return res.status(500).json({ message: "Erreur suppression logo", error });
  }
};
