import Nodemailer from "nodemailer";
import { MailtrapTransport } from "mailtrap";
import { env } from "../../config/env-config.js";
import { logger } from "../../config/logger.js";

type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  category: string;
};

let transport: ReturnType<typeof Nodemailer.createTransport> | null = null;

const getTransport = () => {
  if (!env.mail.token) {
    throw new Error("MAILTRAP_TOKEN n'est pas configuré");
  }
  if (!env.mail.fromEmail) {
    throw new Error("MAILTRAP_FROM_EMAIL n'est pas configuré");
  }
  if (!transport) {
    transport = Nodemailer.createTransport(
      MailtrapTransport({ token: env.mail.token }),
    );
  }
  return transport;
};

export const EmailService = {
  send: async (input: SendEmailInput) => {
    try {
      const result = await getTransport().sendMail({
        from: {
          address: env.mail.fromEmail!,
          name: env.mail.fromName,
        },
        to: input.to,
        replyTo: input.replyTo,
        subject: input.subject,
        text: input.text,
        html: input.html,
        category: input.category,
      });
      return result;
    } catch (error) {
      logger.error("Échec de l'envoi d'un email transactionnel", {
        category: input.category,
        error: error instanceof Error ? error.message : "Erreur inconnue",
      });
      throw error;
    }
  },
};
