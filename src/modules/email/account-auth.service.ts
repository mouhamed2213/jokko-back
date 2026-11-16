import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";
import { env } from "../../config/env-config.js";
import { EmailService } from "./email.service.js";
import { emailTemplates } from "./email-templates.js";

export type AccountType = "USER" | "SUPER_ADMIN";
type TokenType = "EMAIL_VERIFICATION" | "PASSWORD_RESET" | "EMAIL_CHANGE";

const TOKEN_TTL_MS = 30 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

type Account = {
  id: number;
  name: string;
  email: string;
  password: string;
  emailVerifiedAt: Date | null;
};

const getAccount = async (type: AccountType, id: number): Promise<Account | null> => {
  if (type === "USER") {
    return prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, password: true, emailVerifiedAt: true },
    });
  }
  return prisma.superAdmin.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, password: true, emailVerifiedAt: true },
  });
};

const findAccountsByEmail = async (email: string) => {
  const normalizedEmail = email.trim().toLowerCase();
  const [user, superAdmin] = await Promise.all([
    prisma.user.findUnique({ where: { email: normalizedEmail } }),
    prisma.superAdmin.findUnique({ where: { email: normalizedEmail } }),
  ]);
  return [
    ...(user ? [{ type: "USER" as const, id: user.id, name: user.name, email: user.email }] : []),
    ...(superAdmin ? [{ type: "SUPER_ADMIN" as const, id: superAdmin.id, name: superAdmin.name, email: superAdmin.email }] : []),
  ];
};

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const createToken = async (
  type: TokenType,
  accountType: AccountType,
  accountId: number,
  targetEmail?: string,
) => {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  if (accountType === "USER") {
    await prisma.authToken.deleteMany({
      where: { userId: accountId, type, consumedAt: null },
    });
    await prisma.authToken.create({
      data: { tokenHash, type, userId: accountId, targetEmail, expiresAt },
    });
  } else {
    await prisma.authToken.deleteMany({
      where: { superAdminId: accountId, type, consumedAt: null },
    });
    await prisma.authToken.create({
      data: { tokenHash, type, superAdminId: accountId, targetEmail, expiresAt },
    });
  }
  return rawToken;
};

const canSendToken = async (
  type: TokenType,
  accountType: AccountType,
  accountId: number,
) => {
  const where = accountType === "USER"
    ? { userId: accountId, type }
    : { superAdminId: accountId, type };
  const recentToken = await prisma.authToken.findFirst({
    where: { ...where, createdAt: { gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
    select: { id: true },
  });
  return !recentToken;
};

const buildFrontendUrl = (path: string, token: string) => {
  const baseUrl = env.frontendUrl || "http://localhost:5173";
  const url = new URL(path, baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
};

const sendTokenEmail = async (
  type: TokenType,
  account: Pick<Account, "name" | "email">,
  token: string,
  targetEmail?: string,
) => {
  if (type === "EMAIL_VERIFICATION") {
    const template = emailTemplates.verification(
      account.name,
      buildFrontendUrl("/verify-email", token),
    );
    await EmailService.send({ to: account.email, ...template, category: "email-verification" });
    return;
  }
  if (type === "PASSWORD_RESET") {
    const template = emailTemplates.passwordReset(
      account.name,
      buildFrontendUrl("/reset-password", token),
    );
    await EmailService.send({ to: account.email, ...template, category: "password-reset" });
    return;
  }
  const template = emailTemplates.emailChange(
    account.name,
    buildFrontendUrl("/confirm-email-change", token),
    targetEmail || "",
  );
  await EmailService.send({ to: targetEmail || account.email, ...template, category: "email-change" });
};

export const AccountAuthService = {
  requestEmailVerification: async (accountType: AccountType, accountId: number) => {
    const account = await getAccount(accountType, accountId);
    if (!account) throw new Error("Compte introuvable");
    if (account.emailVerifiedAt) return { sent: false, alreadyVerified: true };
    if (!(await canSendToken("EMAIL_VERIFICATION", accountType, accountId))) {
      return { sent: false, cooldown: true };
    }
    const token = await createToken("EMAIL_VERIFICATION", accountType, accountId);
    try {
      await sendTokenEmail("EMAIL_VERIFICATION", account, token);
      return { sent: true };
    } catch (error) {
      logger.error("Impossible d'envoyer l'email de vérification", {
        accountType,
        accountId,
        error: error instanceof Error ? error.message : "Erreur inconnue",
      });
      throw error;
    }
  },

  verifyEmail: async (rawToken: string) => {
    const token = await prisma.authToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true, superAdmin: true },
    });
    if (
      !token ||
      token.type !== "EMAIL_VERIFICATION" ||
      token.consumedAt ||
      token.expiresAt <= new Date()
    ) {
      throw new Error("Lien de vérification invalide ou expiré");
    }
    await prisma.$transaction(async (tx) => {
      if (token.userId) {
        await tx.user.update({
          where: { id: token.userId },
          data: { emailVerifiedAt: new Date() },
        });
      } else if (token.superAdminId) {
        await tx.superAdmin.update({
          where: { id: token.superAdminId },
          data: { emailVerifiedAt: new Date() },
        });
      }
      await tx.authToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      });
    });
  },

  requestPasswordReset: async (email: string) => {
    const accounts = await findAccountsByEmail(email);
    for (const account of accounts) {
      if (!(await canSendToken("PASSWORD_RESET", account.type, account.id))) continue;
      const token = await createToken("PASSWORD_RESET", account.type, account.id);
      try {
        await sendTokenEmail("PASSWORD_RESET", account, token);
      } catch (error) {
        logger.error("Impossible d'envoyer l'email de réinitialisation", {
          accountType: account.type,
          accountId: account.id,
          error: error instanceof Error ? error.message : "Erreur inconnue",
        });
      }
    }
  },

  resetPassword: async (rawToken: string, newPassword: string) => {
    const token = await prisma.authToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!token || token.type !== "PASSWORD_RESET" || token.consumedAt || token.expiresAt <= new Date()) {
      throw new Error("Lien de réinitialisation invalide ou expiré");
    }
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction(async (tx) => {
      if (token.userId) {
        await tx.user.update({ where: { id: token.userId }, data: { password: hashedPassword } });
      } else if (token.superAdminId) {
        await tx.superAdmin.update({ where: { id: token.superAdminId }, data: { password: hashedPassword } });
      }
      await tx.authToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
    });
  },

  changePassword: async (
    accountType: AccountType,
    accountId: number,
    currentPassword: string,
    newPassword: string,
  ) => {
    const account = await getAccount(accountType, accountId);
    if (!account || !(await bcrypt.compare(currentPassword, account.password))) {
      throw new Error("Mot de passe actuel incorrect");
    }
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    if (accountType === "USER") {
      await prisma.user.update({ where: { id: accountId }, data: { password: hashedPassword } });
    } else {
      await prisma.superAdmin.update({ where: { id: accountId }, data: { password: hashedPassword } });
    }
    try {
      const template = emailTemplates.passwordChanged(account.name);
      await EmailService.send({ to: account.email, ...template, category: "password-changed" });
    } catch (error) {
      logger.error("Mot de passe modifié mais notification email non envoyée", {
        accountType,
        accountId,
        error: error instanceof Error ? error.message : "Erreur inconnue",
      });
    }
  },

  requestEmailChange: async (
    accountType: AccountType,
    accountId: number,
    currentPassword: string,
    newEmail: string,
  ) => {
    const account = await getAccount(accountType, accountId);
    if (!account || !(await bcrypt.compare(currentPassword, account.password))) {
      throw new Error("Mot de passe actuel incorrect");
    }
    const normalizedEmail = newEmail.trim().toLowerCase();
    if (!normalizedEmail || normalizedEmail === account.email.toLowerCase()) {
      throw new Error("La nouvelle adresse email doit être différente de l'adresse actuelle");
    }
    const [userConflict, adminConflict] = await Promise.all([
      prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } }),
      prisma.superAdmin.findUnique({ where: { email: normalizedEmail }, select: { id: true } }),
    ]);
    if (userConflict || adminConflict) throw new Error("Cette adresse email est déjà utilisée");
    if (!(await canSendToken("EMAIL_CHANGE", accountType, accountId))) {
      throw new Error("Veuillez patienter avant de demander un nouveau lien");
    }
    const token = await createToken("EMAIL_CHANGE", accountType, accountId, normalizedEmail);
    await sendTokenEmail("EMAIL_CHANGE", account, token, normalizedEmail);
  },

  confirmEmailChange: async (rawToken: string) => {
    const token = await prisma.authToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true, superAdmin: true },
    });
    if (!token || token.type !== "EMAIL_CHANGE" || token.consumedAt || token.expiresAt <= new Date() || !token.targetEmail) {
      throw new Error("Lien de confirmation invalide ou expiré");
    }
    const oldEmail = token.user?.email ?? token.superAdmin?.email;
    const name = token.user?.name ?? token.superAdmin?.name ?? "Utilisateur";
    await prisma.$transaction(async (tx) => {
      if (token.userId) {
        await tx.user.update({
          where: { id: token.userId },
          data: { email: token.targetEmail!, emailVerifiedAt: new Date() },
        });
      } else if (token.superAdminId) {
        await tx.superAdmin.update({
          where: { id: token.superAdminId },
          data: { email: token.targetEmail!, emailVerifiedAt: new Date() },
        });
      }
      await tx.authToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
    });
    if (oldEmail) {
      try {
        const template = emailTemplates.emailChanged(name, token.targetEmail);
        await EmailService.send({ to: oldEmail, ...template, category: "email-changed" });
      } catch (error) {
        logger.error("Adresse email modifiée mais notification de sécurité non envoyée", {
          tokenId: token.id,
          error: error instanceof Error ? error.message : "Erreur inconnue",
        });
      }
    }
  },
};
