import type { NextFunction, Response } from "express";
import { logger } from "../../config/logger.js";
import type { AuthRequest } from "../../middlewares/auth.middleware.js";
import { NotificationService } from "./notification.service.js";

export const streamNotifications = async (req: AuthRequest, res: Response) => {
  const shopId = req.user!.shopId;
  const userId = req.user!.userId;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const activeClients = NotificationService.registerClient(shopId, res);
  logger.info(
    `📡 SSE connecté — Shop: ${shopId} — User: ${userId} — Clients actifs: ${activeClients}`,
  );

  res.write(
    `event: connected\ndata: ${JSON.stringify({ message: "Connexion établie", shopId })}\n\n`,
  );

  try {
    const alerts = await NotificationService.getInitialStockAlerts(shopId);
    if (alerts.total > 0) {
      res.write(
        `event: stock_alert\ndata: ${JSON.stringify({ type: "initial", ...alerts })}\n\n`,
      );
    }
  } catch (error) {
    logger.error("Erreur envoi alertes initiales SSE", { error });
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 30000);

  req.on("close", () => {
    clearInterval(heartbeat);
    NotificationService.unregisterClient(shopId, res);
    logger.info(`📡 SSE déconnecté — Shop: ${shopId} — User: ${userId}`);
  });
};

export const getStockAlerts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const alerts = await NotificationService.getStockAlerts(req.user!.shopId);
    return res.status(200).json(alerts);
  } catch (error) {
    return next(error);
  }
};
