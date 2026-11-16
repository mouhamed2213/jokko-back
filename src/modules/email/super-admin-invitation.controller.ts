import { createHash } from "node:crypto";
import bcrypt from "bcrypt";
import type { Request, Response } from "express";
import { prisma } from "../../config/prisma.js";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

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

export const acceptSuperAdminInvitation = async (req: Request, res: Response) => {
  if (isRateLimited(req)) {
    return res.status(429).json({ message: "Trop de tentatives. Réessayez dans quelques minutes." });
  }

  const tokenValue = req.body?.token;
  const password = req.body?.password;
  if (typeof tokenValue !== "string" || tokenValue.length < 32 || tokenValue.length > 256) {
    return res.status(400).json({ message: "Lien d'invitation invalide ou expiré." });
  }
  if (typeof password !== "string" || password.length < 12 || password.length > 128) {
    return res.status(400).json({ message: "Le mot de passe doit contenir entre 12 et 128 caractères." });
  }

  try {
    const token = await prisma.authToken.findUnique({
      where: { tokenHash: hashToken(tokenValue) },
      select: { id: true, type: true, superAdminId: true, consumedAt: true, expiresAt: true },
    });
    if (!token || token.type !== "SUPER_ADMIN_INVITATION" || !token.superAdminId || token.consumedAt || token.expiresAt <= new Date()) {
      return res.status(400).json({ message: "Lien d'invitation invalide, expiré ou déjà utilisé." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.authToken.updateMany({
        where: { id: token.id, type: "SUPER_ADMIN_INVITATION", consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new Error("Ce lien a déjà été utilisé ou a expiré.");

      await tx.superAdmin.update({
        where: { id: token.superAdminId! },
        data: { password: passwordHash, emailVerifiedAt: now, isActive: true },
      });
    });
    return res.status(200).json({ message: "Invitation acceptée. Vous pouvez maintenant vous connecter." });
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : "Impossible d'accepter l'invitation.",
    });
  }
};
