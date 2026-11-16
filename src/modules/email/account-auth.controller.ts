import type { Response, Request } from "express";
import { logger } from "../../config/logger.js";
import { AppError } from "../../utils/errors.js";
import { prisma } from "../../config/prisma.js";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { AccountAuthService } from "./account-auth.service.js";

const getAccountId = (req: AuthRequest) => req.user?.userId;

const isValidEmail = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const isValidPassword = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 8;

const publicRequestCounts = new Map<string, { count: number; resetAt: number }>();

const isPublicRateLimited = (req: Request, action: string, maxRequests = 10) => {
  const now = Date.now();
  const key = `${action}:${req.ip || "unknown"}`;
  const current = publicRequestCounts.get(key);
  if (!current || current.resetAt <= now) {
    publicRequestCounts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  current.count += 1;
  if (publicRequestCounts.size > 5000) {
    for (const [storedKey, value] of publicRequestCounts) {
      if (value.resetAt <= now) publicRequestCounts.delete(storedKey);
    }
  }
  return current.count > maxRequests;
};

const respondWithBadRequest = (res: Response, error: unknown) => {
  const statusCode = error instanceof AppError ? error.statusCode : 400;
  return res.status(statusCode).json({
    message: error instanceof Error ? error.message : "Demande invalide",
  });
};

export const AccountAuthController = {
  forgotPassword: async (req: Request, res: Response) => {
    const email = req.body?.email;
    if (isPublicRateLimited(req, "forgot-password", 5)) {
      return res.status(200).json({
        message: "Si cette adresse correspond à un compte, un lien de réinitialisation sera envoyé.",
      });
    }
    if (isValidEmail(email)) {
      await AccountAuthService.requestPasswordReset(email).catch((error) => {
        logger.error("Erreur pendant la demande de réinitialisation", {
          error: error instanceof Error ? error.message : "Erreur inconnue",
        });
      });
    }
    return res.status(200).json({
      message: "Si cette adresse correspond à un compte, un lien de réinitialisation sera envoyé.",
    });
  },

  resetPassword: async (req: Request, res: Response) => {
    if (isPublicRateLimited(req, "password-reset", 10)) {
      return res.status(429).json({ message: "Trop de tentatives. Réessayez plus tard." });
    }
    const { token, password } = req.body ?? {};
    if (typeof token !== "string" || !token || !isValidPassword(password)) {
      return res.status(400).json({
        message: "Un lien valide et un mot de passe d'au moins 8 caractères sont requis.",
      });
    }
    try {
      await AccountAuthService.resetPassword(token, password);
      return res.status(200).json({ message: "Mot de passe réinitialisé avec succès." });
    } catch (error) {
      return respondWithBadRequest(res, error);
    }
  },

  verifyEmail: async (req: Request, res: Response) => {
    if (isPublicRateLimited(req, "email-verification", 15)) {
      return res.status(429).json({ message: "Trop de tentatives. Réessayez plus tard." });
    }
    const token = req.body?.token;
    if (typeof token !== "string" || !token) {
      return res.status(400).json({ message: "Jeton de vérification manquant." });
    }
    try {
      await AccountAuthService.verifyEmail(token);
      return res.status(200).json({ message: "Adresse email vérifiée avec succès." });
    } catch (error) {
      return respondWithBadRequest(res, error);
    }
  },

  confirmEmailChange: async (req: Request, res: Response) => {
    if (isPublicRateLimited(req, "email-change-confirm", 10)) {
      return res.status(429).json({ message: "Trop de tentatives. Réessayez plus tard." });
    }
    const token = req.body?.token;
    if (typeof token !== "string" || !token) {
      return res.status(400).json({ message: "Jeton de confirmation manquant." });
    }
    try {
      await AccountAuthService.confirmEmailChange(token);
      return res.status(200).json({ message: "Adresse email modifiée avec succès. Reconnectez-vous avec votre nouvelle adresse." });
    } catch (error) {
      return respondWithBadRequest(res, error);
    }
  },

  resendVerification: async (req: AuthRequest, res: Response) => {
    const accountId = getAccountId(req);
    if (!accountId) return res.status(401).json({ message: "Session invalide." });
    try {
      const result = await AccountAuthService.requestEmailVerification("USER", accountId);
      if (result.alreadyVerified) {
        return res.status(200).json({ message: "Cette adresse email est déjà vérifiée." });
      }
      if (result.cooldown) {
        return res.status(429).json({ message: "Veuillez patienter avant de demander un nouveau lien." });
      }
      return res.status(200).json({ message: "Un lien de vérification a été envoyé." });
    } catch (error) {
      logger.error("Échec de renvoi de vérification email", { accountId, error });
      return res.status(503).json({ message: "Impossible d'envoyer l'email pour le moment. Réessayez plus tard." });
    }
  },

  resendSuperAdminVerification: async (req: AuthRequest, res: Response) => {
    const accountId = getAccountId(req);
    if (!accountId) return res.status(401).json({ message: "Session invalide." });
    try {
      const result = await AccountAuthService.requestEmailVerification("SUPER_ADMIN", accountId);
      if (result.alreadyVerified) {
        return res.status(200).json({ message: "Cette adresse email est déjà vérifiée." });
      }
      if (result.cooldown) {
        return res.status(429).json({ message: "Veuillez patienter avant de demander un nouveau lien." });
      }
      return res.status(200).json({ message: "Un lien de vérification a été envoyé." });
    } catch (error) {
      logger.error("Échec de renvoi de vérification Super Admin", { accountId, error });
      return res.status(503).json({ message: "Impossible d'envoyer l'email pour le moment. Réessayez plus tard." });
    }
  },

  emailStatus: async (req: AuthRequest, res: Response) => {
    const accountId = getAccountId(req);
    if (!accountId) return res.status(401).json({ message: "Session invalide." });
    try {
      const account = await prisma.user.findUnique({
        where: { id: accountId },
        select: { email: true, emailVerifiedAt: true },
      });
      if (!account) return res.status(404).json({ message: "Compte introuvable." });
      return res.status(200).json(account);
    } catch (error) {
      logger.error("Erreur de lecture du statut de vérification email", { accountId, error });
      return res.status(500).json({ message: "Impossible de récupérer le statut email." });
    }
  },

  superAdminEmailStatus: async (req: AuthRequest, res: Response) => {
    const accountId = getAccountId(req);
    if (!accountId) return res.status(401).json({ message: "Session invalide." });
    try {
      const account = await prisma.superAdmin.findUnique({
        where: { id: accountId },
        select: { email: true, emailVerifiedAt: true },
      });
      if (!account) return res.status(404).json({ message: "Compte introuvable." });
      return res.status(200).json(account);
    } catch (error) {
      logger.error("Erreur de lecture du statut email Super Admin", { accountId, error });
      return res.status(500).json({ message: "Impossible de récupérer le statut email." });
    }
  },

  requestEmailChange: async (req: AuthRequest, res: Response) => {
    const accountId = getAccountId(req);
    const { currentPassword, newEmail } = req.body ?? {};
    if (!accountId) return res.status(401).json({ message: "Session invalide." });
    if (!isValidEmail(newEmail) || typeof currentPassword !== "string" || !currentPassword) {
      return res.status(400).json({ message: "Nouvelle adresse email et mot de passe actuel requis." });
    }
    try {
      await AccountAuthService.requestEmailChange("USER", accountId, currentPassword, newEmail);
      return res.status(200).json({ message: "Un lien de confirmation a été envoyé à votre nouvelle adresse email." });
    } catch (error) {
      return respondWithBadRequest(res, error);
    }
  },

  requestSuperAdminEmailChange: async (req: AuthRequest, res: Response) => {
    const accountId = getAccountId(req);
    const { currentPassword, newEmail } = req.body ?? {};
    if (!accountId) return res.status(401).json({ message: "Session invalide." });
    if (!isValidEmail(newEmail) || typeof currentPassword !== "string" || !currentPassword) {
      return res.status(400).json({ message: "Nouvelle adresse email et mot de passe actuel requis." });
    }
    try {
      await AccountAuthService.requestEmailChange("SUPER_ADMIN", accountId, currentPassword, newEmail);
      return res.status(200).json({ message: "Un lien de confirmation a été envoyé à votre nouvelle adresse email." });
    } catch (error) {
      return respondWithBadRequest(res, error);
    }
  },

  changePassword: async (req: AuthRequest, res: Response) => {
    const accountId = getAccountId(req);
    const { currentPassword, newPassword } = req.body ?? {};
    if (!accountId) return res.status(401).json({ message: "Session invalide." });
    if (typeof currentPassword !== "string" || !currentPassword || !isValidPassword(newPassword)) {
      return res.status(400).json({ message: "Mot de passe actuel et nouveau mot de passe d'au moins 8 caractères requis." });
    }
    try {
      await AccountAuthService.changePassword("USER", accountId, currentPassword, newPassword);
      return res.status(200).json({ message: "Mot de passe modifié avec succès." });
    } catch (error) {
      return respondWithBadRequest(res, error);
    }
  },

  changeSuperAdminPassword: async (req: AuthRequest, res: Response) => {
    const accountId = getAccountId(req);
    const { currentPassword, newPassword } = req.body ?? {};
    if (!accountId) return res.status(401).json({ message: "Session invalide." });
    if (typeof currentPassword !== "string" || !currentPassword || !isValidPassword(newPassword)) {
      return res.status(400).json({ message: "Mot de passe actuel et nouveau mot de passe d'au moins 8 caractères requis." });
    }
    try {
      await AccountAuthService.changePassword("SUPER_ADMIN", accountId, currentPassword, newPassword);
      return res.status(200).json({ message: "Mot de passe modifié avec succès." });
    } catch (error) {
      return respondWithBadRequest(res, error);
    }
  },
};
