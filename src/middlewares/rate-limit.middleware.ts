import type { NextFunction, Request, Response } from "express";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  message: string;
  keyByPath?: boolean;
};

type WindowEntry = {
  count: number;
  resetAt: number;
};

export const createRateLimiter = ({ windowMs, max, message, keyByPath = false }: RateLimitOptions) => {
  // Chaque limiteur possède son propre compteur : les règles globales et
  // spécifiques ne se remplacent donc pas mutuellement.
  const windows = new Map<string, WindowEntry>();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) {
      if (entry.resetAt <= now) windows.delete(key);
    }
  }, 60_000);
  cleanupInterval.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === "OPTIONS") {
      next();
      return;
    }

    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = keyByPath ? `${ip}:${req.baseUrl}${req.path}` : ip;
    let entry = windows.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      windows.set(key, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.max(0, Math.ceil((entry.resetAt - now) / 1000));

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSeconds));

    if (entry.count > max) {
      res.setHeader("Retry-After", String(resetSeconds));
      res.status(429).json({ message, retryAfter: resetSeconds });
      return;
    }

    next();
  };
};

export const apiRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 120,
  message: "Trop de requêtes. Veuillez réessayer dans une minute.",
});

export const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 5,
  keyByPath: true,
  message: "Trop de tentatives de connexion. Réessayez dans 15 minutes.",
});

export const passwordRecoveryRateLimiter = createRateLimiter({
  windowMs: 60 * 60_000,
  max: 3,
  keyByPath: true,
  message: "Trop de demandes de réinitialisation. Réessayez dans une heure.",
});

export const passwordResetRateLimiter = createRateLimiter({
  windowMs: 60 * 60_000,
  max: 5,
  keyByPath: true,
  message: "Trop de tentatives de réinitialisation. Réessayez dans une heure.",
});

export const emailActionRateLimiter = createRateLimiter({
  windowMs: 60 * 60_000,
  max: 5,
  keyByPath: true,
  message: "Trop de demandes liées à l'e-mail. Réessayez dans une heure.",
});

export const emailVerificationRateLimiter = createRateLimiter({
  windowMs: 60 * 60_000,
  max: 10,
  keyByPath: true,
  message: "Trop de tentatives de vérification. Réessayez dans une heure.",
});

export const invitationRateLimiter = createRateLimiter({
  windowMs: 60 * 60_000,
  max: 5,
  keyByPath: true,
  message: "Trop de tentatives d'acceptation d'invitation. Réessayez dans une heure.",
});

export const contactRateLimiter = createRateLimiter({
  windowMs: 60 * 60_000,
  max: 5,
  keyByPath: true,
  message: "Trop de messages envoyés. Réessayez dans une heure.",
});
