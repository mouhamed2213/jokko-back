import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env-config.js";
import { logger } from "../config/logger.js";
import { PlanType } from "../database/prisma/generated/prisma/enums.js";
import { UnauthorizedError } from "../utils/errors.js";

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

export const protect = (
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

// Middleware pour le Super Admin (JWT séparé)
export const protectSuperAdmin = (
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

    const decoded = jwt.verify(token, env.secret.jwt) as {
      userId: number;
      email: string;
      role: string;
    };

    if (decoded.role !== "SUPER_ADMIN") {
      logger.warn("Tentative d'accès Super Admin avec un rôle invalide");
      return res.status(403).json({
        message: "Accès interdit : rôle Super Admin requis",
      });
    }

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      shopId: 0,
    } as AuthRequest["user"];

    next();
  } catch (e) {
    if (e instanceof jwt.JsonWebTokenError || e instanceof jwt.TokenExpiredError) {
      logger.warn("Tentative d'accès Super Admin avec un token invalide ou expiré");
      return res.status(401).json({
        message: "Token invalide ou expiré",
      });
    }

    logger.error("Erreur lors de la vérification du token Super Admin", e);
    return res.status(500).json({
      message: "Erreur lors de l'authentification Super Admin",
    });
  }
};
