import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/errors.js";

const GENERIC_SERVER_ERROR_MESSAGE =
  "Une erreur interne est survenue. Veuillez réessayer plus tard.";

/**
 * Traduit les erreurs techniques connues (Prisma, Multer, JSON, JWT)
 * en réponses HTTP propres et compréhensibles pour l'utilisateur,
 * sans jamais exposer de détails internes (SQL, colonnes, stack traces).
 */
function mapKnownTechnicalError(
  err: any,
): { statusCode: number; message: string; code?: string } | null {
  if (!err || typeof err !== "object") return null;

  // 1. JSON malformé envoyé dans req.body
  if (err instanceof SyntaxError && (err as any).status === 400 && "body" in err) {
    return {
      statusCode: 400,
      message: "Le format de la requête est invalide.",
      code: "INVALID_JSON",
    };
  }

  // 2. Erreurs Multer (upload de fichiers)
  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return {
        statusCode: 400,
        message: "Le fichier dépasse la taille maximale autorisée (5 Mo).",
        code: "FILE_TOO_LARGE",
      };
    }
    return {
      statusCode: 400,
      message: "Fichier invalide ou non pris en charge.",
      code: "INVALID_UPLOAD",
    };
  }

  // 3. Erreurs JWT
  if (err.name === "TokenExpiredError") {
    return {
      statusCode: 401,
      message: "Votre session a expiré. Veuillez vous reconnecter.",
      code: "TOKEN_EXPIRED",
    };
  }
  if (err.name === "JsonWebTokenError") {
    return {
      statusCode: 401,
      message: "Session invalide. Veuillez vous reconnecter.",
      code: "INVALID_TOKEN",
    };
  }

  // 4. Erreurs Prisma connues (jamais exposer err.message ni err.meta)
  if (typeof err.code === "string" && err.code.startsWith("P2")) {
    switch (err.code) {
      case "P2002":
        return {
          statusCode: 409,
          message: "Cette valeur existe déjà et ne peut pas être dupliquée.",
          code: "DUPLICATE_ENTRY",
        };
      case "P2003":
        return {
          statusCode: 400,
          message:
            "Impossible d'effectuer cette opération car une référence liée est invalide ou utilisée.",
          code: "FOREIGN_KEY_CONSTRAINT",
        };
      case "P2025":
        return {
          statusCode: 404,
          message: "L'élément demandé est introuvable.",
          code: "NOT_FOUND",
        };
      case "P2023":
        return {
          statusCode: 400,
          message: "Identifiant invalide.",
          code: "INVALID_ID",
        };
    }
  }

  return null;
}

export const ErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  try {
    // 1. Erreurs métier contrôlées (AppError et sous-classes)
    if (err instanceof AppError) {
      logger.warn(`${err.constructor.name}: ${err.message}`, {
        url: req.originalUrl,
        method: req.method,
        statusCode: err.statusCode,
      });

      const body: Record<string, unknown> = {
        success: false,
        message: err.message,
      };
      if ("code" in err && err.code) {
        body.code = err.code;
      }

      res.status(err.statusCode || 400).json(body);
      return;
    }

    // 2. Erreurs techniques connues (Prisma, Multer, JSON, JWT)
    const mapped = mapKnownTechnicalError(err);
    if (mapped) {
      logger.warn(`Mapped technical error (${mapped.code ?? mapped.statusCode})`, {
        url: req.originalUrl,
        method: req.method,
        originalName: err?.name,
        originalCode: err?.code,
        originalMessage: err?.message,
      });

      res.status(mapped.statusCode).json({
        success: false,
        message: mapped.message,
        ...(mapped.code ? { code: mapped.code } : {}),
      });
      return;
    }

    // 3. Toute autre erreur technique : log détaillé serveur + message neutre client
    const errorId = `ERR-${randomBytes(4).toString("hex").toUpperCase()}`;
    logger.error("Unexpected technical error", {
      errorId,
      name: err?.name,
      code: err?.code,
      message: err?.message,
      stack: err?.stack,
      url: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString(),
    });

    res.status(500).json({
      success: false,
      message: GENERIC_SERVER_ERROR_MESSAGE,
      errorId,
    });
  } catch (criticalError) {
    logger.error("Critical failure in ErrorHandler", {
      error: criticalError instanceof Error ? criticalError.stack : String(criticalError),
    });

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: GENERIC_SERVER_ERROR_MESSAGE,
      });
    }
  }
};
