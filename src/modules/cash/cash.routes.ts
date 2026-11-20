import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import {
  addTransaction,
  closeCash,
  getCashById,
  getCashHistory,
  getCurrentCash,
  openCash,
} from "./cash.controller.js";

const router = Router();

router.get(
  "/current",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getCurrentCash,
);
router.get(
  "/history",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getCashHistory,
);
router.get("/:id", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getCashById);
router.post("/open", protect, authorizeRoles("ADMIN", "EMPLOYEE"), openCash);
router.patch(
  "/:id/close",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  closeCash,
);
router.post(
  "/transactions",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  addTransaction,
);

export default router;
