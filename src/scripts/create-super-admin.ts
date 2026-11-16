import bcrypt from "bcrypt";
import "dotenv/config";
import { env } from "../config/env-config.js";
import { logger } from "../config/logger.js";
import { prisma } from "../config/prisma.js";
import { AccountAuthService } from "../modules/email/account-auth.service.js";


export async function seedAdmin() {
  try {
    const email = env.secret.ADMIN_EMAIL;
    const password = env.secret.ADMIN_PASSWORD;

    if (!email || !password) {
      logger.error("❌ email admin or or password is not missing.");
    }
    const existing = await prisma.superAdmin.findUnique({ where: { email } });

    if (existing) {
      logger.info("✅ Super Admin existe déjà :", email);
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.superAdmin.create({
      data: {
        name: "Super Admin Jokko Business",
        email,
        password: hashedPassword,
      },
    });

    logger.info("✅ Super Admin créé avec succès !");
    const createdAdmin = await prisma.superAdmin.findUnique({
      where: { email },
      select: { id: true },
    });
    if (createdAdmin) {
      try {
        await AccountAuthService.requestEmailVerification("SUPER_ADMIN", createdAdmin.id);
      } catch (emailError) {
        logger.error("Super Admin créé, mais email de vérification non envoyé", {
          error: emailError instanceof Error ? emailError.message : "Erreur inconnue",
        });
      }
    }
    logger.info("⚠️  Le Super Admin doit confirmer son adresse email.");
  } catch (e) {
    logger.error(" ❌ Seed admin Error");
  }
}
