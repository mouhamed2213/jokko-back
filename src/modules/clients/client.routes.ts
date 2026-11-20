import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import { validateNumericParams } from "../../middlewares/validate.middleware.js";
import {
  createClient,
  deleteClient,
  getClientById,
  getClients,
  updateClient,
} from "./client.controller.js";

const router = Router();

router.get("/", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getClients);
router.get(
  "/:id",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateNumericParams("id"),
  getClientById,
);
router.post("/", protect, authorizeRoles("ADMIN", "EMPLOYEE"), createClient);
router.put(
  "/:id",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateNumericParams("id"),
  updateClient,
);
router.delete(
  "/:id",
  protect,
  authorizeRoles("ADMIN"),
  validateNumericParams("id"),
  deleteClient,
);

export default router;
