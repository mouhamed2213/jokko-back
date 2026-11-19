import type { NextFunction, Request, Response } from "express";
import { logger } from "../config/logger.js";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
};

type ClientRecord = {
  count: number;
  resetAt: number;
};

export function createRateLimiter(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    message = "Trop de requêtes, veuillez réessayer ultérieurement.",
    keyGenerator = (req) =>
      req.ip ||
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown",
  } = options;

  const hits = new Map<string, ClientRecord>();

  // Nettoyage régulier des entrées expirées toutes les 2 minutes pour éviter les fuites mémoire
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now >= record.resetAt) {
        hits.delete(key);
      }
    }
  }, 2 * 60 * 1000);

  // Permet au processus Node de s'arrêter proprement sans attendre ce timer
  if (cleanupTimer.unref) {
    cleanupTimer.unref();
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);
    const now = Date.now();
    let record = hits.get(key);

    if (!record || now >= record.resetAt) {
      record = { count: 1, resetAt: now + windowMs };
      hits.set(key, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, max - record.count);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((record.resetAt - now) / 1000),
    );

    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(record.resetAt / 1000));

    if (record.count > max) {
      res.setHeader("Retry-After", retryAfterSeconds);
      logger.warn(
        `⛔ Rate limit dépassé — IP: ${key} — URL: ${req.method} ${req.originalUrl}`,
      );
      return res.status(429).json({
        code: "TOO_MANY_REQUESTS",
        message,
        retryAfter: retryAfterSeconds,
      });
    }

    return next();
  };
}

// ── Limiteurs prédéfinis ───────────────────────────────────────

/**
 * Limiteur pour les tentatives de connexion (boutique et super admin) :
 * 10 tentatives max par fenêtre de 15 minutes.
 */
export const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Trop de tentatives de connexion. Veuillez réessayer dans 15 minutes.",
});

/**
 * Limiteur pour les demandes de réinitialisation de mot de passe :
 * 5 demandes max par fenêtre de 15 minutes.
 */
export const passwordResetLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Trop de demandes de réinitialisation. Veuillez réessayer dans 15 minutes.",
});
