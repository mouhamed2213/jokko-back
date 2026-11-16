import type { Request, Response } from "express";
import { env } from "../../config/env-config.js";
import { logger } from "../../config/logger.js";
import { EmailService } from "./email.service.js";
import { emailTemplates } from "./email-templates.js";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;
const requests = new Map<string, { count: number; resetAt: number }>();

const isValidEmail = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const isRateLimited = (ip: string) => {
  const now = Date.now();
  const current = requests.get(ip);
  if (!current || current.resetAt <= now) {
    requests.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  if (requests.size > 5000) {
    for (const [key, value] of requests) {
      if (value.resetAt <= now) requests.delete(key);
    }
  }
  return current.count > MAX_REQUESTS;
};

export const ContactController = {
  send: async (req: Request, res: Response) => {
    const { name, email, subject, message, website } = req.body ?? {};
    if (typeof website === "string" && website.trim()) {
      return res.status(200).json({ message: "Votre message a été envoyé." });
    }
    if (isRateLimited(req.ip || "unknown")) {
      return res.status(429).json({ message: "Trop de demandes. Réessayez dans quelques minutes." });
    }
    if (
      typeof name !== "string" || name.trim().length < 2 || name.length > 100 ||
      !isValidEmail(email) ||
      typeof subject !== "string" || subject.trim().length < 3 || subject.length > 120 ||
      typeof message !== "string" || message.trim().length < 10 || message.length > 5000
    ) {
      return res.status(400).json({ message: "Veuillez vérifier les champs du formulaire." });
    }
    if (!env.mail.contactEmail) {
      logger.error("MAILTRAP_CONTACT_EMAIL n'est pas configuré");
      return res.status(503).json({ message: "Le formulaire de contact est temporairement indisponible." });
    }
    try {
      const template = emailTemplates.contactMessage(
        name.trim(),
        email.trim().toLowerCase(),
        subject.trim().replace(/[\r\n]+/g, " "),
        message.trim(),
      );
      await EmailService.send({
        to: env.mail.contactEmail,
        replyTo: email.trim().toLowerCase(),
        ...template,
        category: "contact-form",
      });
      return res.status(200).json({ message: "Votre message a été envoyé. Nous vous répondrons dès que possible." });
    } catch (error) {
      logger.error("Échec de l'envoi du formulaire de contact", {
        error: error instanceof Error ? error.message : "Erreur inconnue",
      });
      return res.status(503).json({ message: "Impossible d'envoyer votre message pour le moment. Réessayez plus tard." });
    }
  },
};
