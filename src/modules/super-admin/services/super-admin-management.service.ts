import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../../../config/prisma.js";
import { env } from "../../../config/env-config.js";
import { EmailService } from "../../email/email.service.js";
import { emailTemplates } from "../../email/email-templates.js";

const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const createInvitation = async (adminId: number) => {
  const recentInvitation = await prisma.authToken.findFirst({
    where: {
      superAdminId: adminId,
      type: "SUPER_ADMIN_INVITATION",
      createdAt: { gt: new Date(Date.now() - 60 * 1000) },
    },
    select: { id: true },
  });
  if (recentInvitation) {
    throw new Error("Veuillez patienter une minute avant de renvoyer une invitation.");
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  await prisma.authToken.deleteMany({
    where: {
      superAdminId: adminId,
      type: "SUPER_ADMIN_INVITATION",
      consumedAt: null,
    },
  });
  await prisma.authToken.create({
    data: {
      tokenHash,
      type: "SUPER_ADMIN_INVITATION",
      superAdminId: adminId,
      expiresAt,
    },
  });
  return rawToken;
};

const sendInvitation = async (admin: { id: number; name: string; email: string }) => {
  const token = await createInvitation(admin.id);
  const baseUrl = env.frontendUrl || "http://localhost:5173";
  const url = new URL("/super-admin/accept-invitation", baseUrl);
  url.searchParams.set("token", token);
  const template = emailTemplates.superAdminInvitation(admin.name, url.toString());
  await EmailService.send({
    to: admin.email,
    ...template,
    category: "super-admin-invitation",
  });
};

export const SuperAdminManagementService = {
  list: async () => {
    const now = new Date();
    const admins = await prisma.superAdmin.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        emailVerifiedAt: true,
        createdAt: true,
        lastLoginAt: true,
        authTokens: {
          where: {
            type: "SUPER_ADMIN_INVITATION",
            consumedAt: null,
            expiresAt: { gt: now },
          },
          select: { id: true },
        },
      },
    });

    return admins.map(({ authTokens, ...admin }) => ({
      ...admin,
      status: admin.isActive
        ? "ACTIVE"
        : !admin.emailVerifiedAt && authTokens.length > 0
          ? "PENDING"
          : !admin.emailVerifiedAt
            ? "INVITATION_EXPIRED"
            : "DISABLED",
    }));
  },

  invite: async (name: string, email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    const [user, existingAdmin] = await Promise.all([
      prisma.user.findFirst({
        where: { email: { equals: normalizedEmail, mode: "insensitive" } },
        select: { id: true },
      }),
      prisma.superAdmin.findFirst({
        where: { email: { equals: normalizedEmail, mode: "insensitive" } },
        select: { id: true, isActive: true, emailVerifiedAt: true },
      }),
    ]);
    if (user || existingAdmin) {
      throw new Error("Cette adresse email est déjà associée à un compte.");
    }

    const unusablePassword = await bcrypt.hash(randomBytes(48).toString("hex"), 12);
    const admin = await prisma.superAdmin.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        password: unusablePassword,
        isActive: false,
      },
      select: { id: true, name: true, email: true },
    });

    try {
      await sendInvitation(admin);
    } catch (error) {
      // Ne pas laisser un compte orphelin si l'invitation ne peut pas être envoyée.
      await prisma.superAdmin.delete({ where: { id: admin.id } }).catch(() => undefined);
      throw new Error("Le compte n'a pas été créé car l'email d'invitation n'a pas pu être envoyé.");
    }
    return { id: admin.id, name: admin.name, email: admin.email, status: "PENDING" as const };
  },

  resendInvitation: async (adminId: number) => {
    const admin = await prisma.superAdmin.findUnique({
      where: { id: adminId },
      select: { id: true, name: true, email: true, isActive: true, emailVerifiedAt: true },
    });
    if (!admin) throw new Error("Super Admin introuvable.");
    if (admin.isActive || admin.emailVerifiedAt) {
      throw new Error("Ce compte a déjà été activé.");
    }
    await sendInvitation(admin);
    return { message: "Une nouvelle invitation a été envoyée." };
  },

  setActive: async (adminId: number, actorId: number, enabled: boolean) => {
    if (adminId === actorId && !enabled) {
      throw new Error("Vous ne pouvez pas désactiver votre propre compte.");
    }

    return prisma.$transaction(async (tx) => {
      const target = await tx.superAdmin.findUnique({
        where: { id: adminId },
        select: { id: true, name: true, email: true, isActive: true, emailVerifiedAt: true },
      });
      if (!target) throw new Error("Super Admin introuvable.");
      if (enabled && !target.emailVerifiedAt) {
        throw new Error("Ce compte doit d'abord accepter son invitation.");
      }
      if (target.isActive === enabled) {
        return { id: target.id, isActive: target.isActive };
      }

      if (!enabled) {
        const activeCount = await tx.superAdmin.count({ where: { isActive: true } });
        if (activeCount <= 1) {
          throw new Error("Impossible de désactiver le dernier Super Admin actif.");
        }
      }

      const updated = await tx.superAdmin.update({
        where: { id: adminId },
        data: { isActive: enabled },
        select: { id: true, isActive: true },
      });
      return updated;
    }, { isolationLevel: "Serializable" });
  },
};
