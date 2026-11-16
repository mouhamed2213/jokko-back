import type { NextFunction, Request, Response } from "express";
import { MaintenanceService } from "./maintenance.service.js";

// Ce middleware est monté après les routes d'authentification et Super Admin.
// Le back-office et son endpoint de désactivation restent donc accessibles.
export const maintenanceMiddleware = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const status = await MaintenanceService.getStatus();
    if (!status.enabled) return next();

    return res.status(503).json({
      code: "MAINTENANCE_MODE",
      message: status.message,
      retryAfter: 300,
    });
  } catch (error) {
    // En cas d'indisponibilité de la configuration, ne pas bloquer toute l'API.
    // L'erreur est transmise au gestionnaire global.
    return next(error);
  }
};
