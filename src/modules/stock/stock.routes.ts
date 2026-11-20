import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import {
  addStockEntry,
  addStockOut,
  getStockMovements,
} from "./stock.controller.js";

const router = Router();

router.get(
  "/movements",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getStockMovements,
);
router.post(
  "/entry",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  addStockEntry,
);
router.post("/out", protect, authorizeRoles("ADMIN", "EMPLOYEE"), addStockOut);

export default router;
