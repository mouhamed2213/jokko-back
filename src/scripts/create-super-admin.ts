import "dotenv/config";
import bcrypt from "bcrypt";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env-config.js";

export async function seedAdmin() {
  try {
    const email = env.secret.ADMIN_EMAIL;
    const password = env.secret.ADMIN_PASSWORD

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
    logger.info("✅ Email    :", email);
    logger.info("✅ Password :", password);
    logger.info("⚠️  Changez ce mot de passe en production !");
  } catch (e) {
    logger.error(" ❌ Seed admin Error");
  }
}
