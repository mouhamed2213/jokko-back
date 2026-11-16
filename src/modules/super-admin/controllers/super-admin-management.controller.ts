import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../../../middlewares/auth.middleware.js";
import { SuperAdminManagementService } from "../services/super-admin-management.service.js";

const parseId = (value: string) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

export const SuperAdminManagementController = {
  list: async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      return res.status(200).json({ admins: await SuperAdminManagementService.list() });
    } catch (error) { next(error); }
  },

  invite: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      if (name.length < 2 || name.length > 100) {
        return res.status(400).json({ message: "Le nom doit contenir entre 2 et 100 caractères." });
      }
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: "Adresse email invalide." });
      }
      const admin = await SuperAdminManagementService.invite(name, email);
      return res.status(201).json({ message: "Invitation envoyée.", admin });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de créer l'invitation.";
      return res.status(400).json({ message });
    }
  },

  resendInvitation: async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ message: "Identifiant invalide." });
      const result = await SuperAdminManagementService.resendInvitation(id);
      return res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de renvoyer l'invitation.";
      return res.status(400).json({ message });
    }
  },

  setActive: async (req: AuthRequest, res: Response) => {
    const id = parseId(req.params.id);
    const enabled = req.body?.enabled;
    if (!id || typeof enabled !== "boolean") {
      return res.status(400).json({ message: "Paramètres invalides." });
    }
    try {
      const admin = await SuperAdminManagementService.setActive(id, req.user!.userId, enabled);
      return res.status(200).json({ message: enabled ? "Compte activé." : "Compte désactivé.", admin });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de modifier ce compte.";
      return res.status(400).json({ message });
    }
  },
};
