import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import {
  createClient,
  deleteClient,
  getClientById,
  getClients,
  updateClient,
} from "./client.controller.js";

const router = Router();

router.get("/", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getClients);
router.get("/:id", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getClientById);
router.post("/", protect, authorizeRoles("ADMIN", "EMPLOYEE"), createClient);
router.put("/:id", protect, authorizeRoles("ADMIN", "EMPLOYEE"), updateClient);
router.delete("/:id", protect, authorizeRoles("ADMIN"), deleteClient);

export default router;
