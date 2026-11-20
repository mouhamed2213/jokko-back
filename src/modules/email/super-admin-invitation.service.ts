import { createHash } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../../config/prisma.js";
import { BadRequestError } from "../../utils/errors.js";

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const SuperAdminInvitationService = {
  accept: async (tokenValue: string, password: string) => {
    const token = await prisma.authToken.findUnique({
      where: { tokenHash: hashToken(tokenValue) },
      select: {
        id: true,
        type: true,
        superAdminId: true,
        consumedAt: true,
        expiresAt: true,
      },
    });
    if (
      !token ||
      token.type !== "SUPER_ADMIN_INVITATION" ||
      !token.superAdminId ||
      token.consumedAt ||
      token.expiresAt <= new Date()
    ) {
      throw new BadRequestError("Lien d'invitation invalide, expiré ou déjà utilisé.");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.authToken.updateMany({
        where: {
          id: token.id,
          type: "SUPER_ADMIN_INVITATION",
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new BadRequestError("Ce lien a déjà été utilisé ou a expiré.");
      }

      await tx.superAdmin.update({
        where: { id: token.superAdminId! },
        data: { password: passwordHash, emailVerifiedAt: now, isActive: true },
      });
    });
  },
};
