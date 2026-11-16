import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env-config.js";
import { logger } from "../config/logger.js";
import { prisma } from "../config/prisma.js";
import { PlanType } from "../database/prisma/generated/prisma/enums.js";
import { UnauthorizedError } from "../utils/errors.js";
import { isShopBlocked } from "../helpers/shop-status.js";

export interface AuthRequest extends Request {
  user?: {
    ownerId: number;
    userId: number;
    shopId: number;
    email: string;
    planType: PlanType;
    role: string;
  };
}

export const protect = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const authHeader = req.headers.authorization;
    // Support du token en query param pour EventSource (SSE)
    const queryToken = req.query.token as string | undefined;

    if (!authHeader && !queryToken) {
      return res
        .status(401)
        .json({ message: "Accès non autorisé : token manquant" });
    }

    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : queryToken;

    if (!token) {
      return res
        .status(401)
        .json({ message: "Accès non autorisé : token manquant" });
    }
    const decoded = jwt.verify(token, env.secret.jwt as string) as {
      ownerId: number;

      userId: number;
      shopId: number;
      email: string;
      planType: PlanType;
      role: string;
    };

    // Boutique archivée : on coupe aussi les sessions déjà ouvertes.
    // (isShopBlocked ne lève jamais d'erreur : fail-open en cas de souci base de données)
    if (decoded.shopId && (await isShopBlocked(decoded.shopId))) {
      return res.status(403).json({
        code: "ACCOUNT_DISABLED",
        message: "Cette boutique est archivée. Contactez le support.",
      });
    }

    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: "Token invalide ou expiré" });
  }
};

export const authorizeRoles = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Accès non autorisé" });
    }
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Accès interdit : permissions insuffisantes" });
    }
    next();
  };
};

// Middleware pour le Super Admin (JWT séparé).
// Le compte est relu en base à chaque requête protégée afin de révoquer
// immédiatement les sessions dont le compte a été supprimé ou dont l'email a changé.
export const protectSuperAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      logger.warn("Tentative d'accès Super Admin sans token");
      return res.status(401).json({
        message: "Accès non autorisé : token manquant",
      });
    }

    const token = authHeader.slice(7).trim();

    if (!token) {
      logger.warn("Tentative d'accès Super Admin avec un token vide");
      return res.status(401).json({
        message: "Accès non autorisé : token manquant",
      });
    }

    const verified = jwt.verify(token, env.secret.jwt);
    if (typeof verified === "string") {
      logger.warn("Tentative d'accès Super Admin avec un payload JWT invalide");
      return res.status(401).json({
        message: "Token invalide ou expiré",
      });
    }

    const decoded = verified as jwt.JwtPayload & {
      userId?: unknown;
      email?: unknown;
      role?: unknown;
    };

    if (
      !Number.isSafeInteger(decoded.userId) ||
      typeof decoded.email !== "string" ||
      decoded.email.length === 0
    ) {
      logger.warn("Tentative d'accès Super Admin avec une identité JWT invalide");
      return res.status(401).json({
        message: "Token invalide ou expiré",
      });
    }

    if (decoded.role !== "SUPER_ADMIN") {
      logger.warn("Tentative d'accès Super Admin avec un rôle invalide");
      return res.status(403).json({
        message: "Accès interdit : rôle Super Admin requis",
      });
    }

    // Ne pas se fier uniquement au JWT : le compte peut avoir été supprimé
    // depuis l'émission du token. L'email est aussi comparé pour invalider
    // les anciennes sessions après une modification de l'identifiant.
    const admin = await prisma.superAdmin.findUnique({
      where: { id: decoded.userId as number },
      select: { id: true, email: true },
    });

    if (!admin || admin.email !== decoded.email) {
      logger.warn("Accès refusé : compte Super Admin absent ou identité modifiée", {
        userId: decoded.userId,
      });
      return res.status(401).json({
        message: "Session Super Admin invalide. Veuillez vous reconnecter.",
      });
    }

    req.user = {
      userId: admin.id,
      email: admin.email,
      role: "SUPER_ADMIN",
      shopId: 0,
    } as AuthRequest["user"];

    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      logger.warn("Tentative d'accès Super Admin avec un token invalide ou expiré");
      return res.status(401).json({
        message: "Token invalide ou expiré",
      });
    }

    // Une panne de base de données ne doit jamais être interprétée comme
    // un compte inexistant, ni laisser passer la requête (fail-closed).
    logger.error("Erreur lors de la vérification du compte Super Admin", error);
    return res.status(503).json({
      message: "Service d'authentification temporairement indisponible",
    });
  }
};
