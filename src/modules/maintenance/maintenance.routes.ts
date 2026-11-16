import { Router } from "express";
import { protectSuperAdmin } from "../../middlewares/auth.middleware.js";
import { MaintenanceService } from "./maintenance.service.js";

const router = Router();

// Statut public utilisé par l'application web avant d'afficher ses pages.
router.get("/status", async (_req, res, next) => {
  try {
    const status = await MaintenanceService.getStatus();
    return res.status(200).json(status);
  } catch (error) {
    return next(error);
  }
});

// Seul un Super Admin authentifié peut activer ou désactiver la maintenance.
router.patch("/", protectSuperAdmin, async (req, res, next) => {
  try {
    const { enabled, message } = req.body ?? {};
    if (typeof enabled !== "boolean" || (message !== undefined && typeof message !== "string")) {
      return res.status(400).json({ message: "Paramètres de maintenance invalides." });
    }
    if (typeof message === "string" && message.trim().length > 1000) {
      return res.status(400).json({ message: "Le message ne doit pas dépasser 1000 caractères." });
    }
    const status = await MaintenanceService.update(enabled, typeof message === "string" ? message : "");
    return res.status(200).json({ message: "Paramètres de maintenance enregistrés.", ...status });
  } catch (error) {
    return next(error);
  }
});

export default router;
