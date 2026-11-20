import type { Request, Response } from "express";
import { SuperAdminInvitationService } from "./super-admin-invitation.service.js";

const attempts = new Map<string, { count: number; resetAt: number }>();
const isRateLimited = (req: Request) => {
  const now = Date.now();
  const key = req.ip || "unknown";
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  current.count += 1;
  if (attempts.size > 5000) {
    for (const [storedKey, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(storedKey);
    }
  }
  return current.count > 10;
};

export const acceptSuperAdminInvitation = async (
  req: Request,
  res: Response,
) => {
  if (isRateLimited(req)) {
    return res
      .status(429)
      .json({ message: "Trop de tentatives. Réessayez dans quelques minutes." });
  }

  const tokenValue = req.body?.token;
  const password = req.body?.password;
  if (
    typeof tokenValue !== "string" ||
    tokenValue.length < 32 ||
    tokenValue.length > 256
  ) {
    return res
      .status(400)
      .json({ message: "Lien d'invitation invalide ou expiré." });
  }
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  ) {
    return res.status(400).json({
      message: "Le mot de passe doit contenir entre 12 et 128 caractères.",
    });
  }

  try {
    await SuperAdminInvitationService.accept(tokenValue, password);
    return res.status(200).json({
      message: "Invitation acceptée. Vous pouvez maintenant vous connecter.",
    });
  } catch (error) {
    return res.status(400).json({
      message:
        error instanceof Error
          ? error.message
          : "Impossible d'accepter l'invitation.",
    });
  }
};
