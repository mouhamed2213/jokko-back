import bcrypt from "bcrypt";
import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { logger } from "../config/logger.js";
import { prisma } from "../config/prisma.js";
import { AuthRequest } from "../middlewares/auth.middleware.js";
import { AuthService } from "../services/auth.service.js";
import { NotFoundError } from "../utils/errors.js";
import { env } from "../config/env-config.js";

// ── Login utilisateur boutique ────────────────────────────────
export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email et mot de passe obligatoires" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        shop: {
          select: {
            status: true,
            name: true,
            subscriptions: { select: { plan: { select: { code: true } } } },
          },
        },
      },
    });

    if (!user) {
      logger.warn(`❌ Tentative de connexion échouée — ${email} (utilisateur non trouvé)`);
      return res.status(401).json({ message: "Email ou mot de passe incorrect" });
    }

    const shopOwner = await prisma.shopOwner.findFirst({
      where: {
        shopId: user.shopId,
      },
    });

    if (!shopOwner) {
      throw new NotFoundError("Propriétaire non retrouvé");
    }

    if (!user.isActive) {
      return res
        .status(403)
        .json({ message: "Compte désactivé. Contactez votre administrateur." });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      logger.warn(
        `❌ Tentative de connexion échouée — ${email} (mauvais mot de passe)`,
      );
      return res.status(401).json({ message: "Email ou mot de passe incorrect" });
    }

    const token = jwt.sign(
      {
        ownerId: shopOwner.userId, //  it for having th context of the owner , and use it to check if shops belons to a user
        userId: user.id, // user who is connected
        shopId: user.shopId,
        plan: user.shop.subscriptions[0].plan.code,
        role: user.role,
      },
      env.secret.jwt ,
      { expiresIn: "3d" },
    );


    logger.info(
      `✅ Connexion réussie — ${user.email} (${user.role}) — Boutique: ${user.shop.name} — Plan: ${user.shop.subscriptions[0].plan.code}`,
    );

    return res.status(200).json({
      message: "Connexion réussie",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        plan: user.shop.subscriptions[0].plan.code,
        shopId: user.shopId,
        shopName: user.shop.name,
      },
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ message: "Erreur lors de la connexion", error });
  }
};

// ── Login Super Admin ─────────────────────────────────────────
export const loginSuperAdmin = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email et mot de passe obligatoires" });
    }

    const admin = await prisma.superAdmin.findUnique({ where: { email } });

    if (!admin) {
      return res.status(401).json({ message: "Identifiants invalides" });
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: "Identifiants invalides" });
    }

    const token = jwt.sign(
      { userId: admin.id, email: admin.email, role: "SUPER_ADMIN" },
      env.secret.jwt,
      { expiresIn: "1d" },
    );

    return res.status(200).json({
      message: "Connexion Super Admin réussie",
      token,
      user: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: "SUPER_ADMIN",
      },
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ message: "Erreur lors de la connexion", error });
  }
};

// ── Mot de passe oublié ───────────────────────────────────────
export const forgotPassword = async (req: Request, res: Response) => {
  // TODO: implémenter l'envoi d'email avec nodemailer
  return res.status(200).json({
    message: "Si cet email existe, un lien de réinitialisation a été envoyé.",
  });
};

export const me = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shopId = req.user!.shopId;
    const userId = req.user!.userId;

    const me = await AuthService.getMe(userId, shopId);

    return res.status(200).json({ message: "ok", me });
  } catch (e) {
    next(e);
  }
};
