import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import {
  getStockAlerts,
  streamNotifications,
} from "./notification.controller.js";

const router = Router();

router.get(
  "/stream",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  streamNotifications,
);
router.get(
  "/stock-alerts",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getStockAlerts,
);

export default router;
