import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import { getDashboardStats } from "./dashboard.controller.js";

const router = Router();

router.get(
  "/stats",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getDashboardStats,
);

export default router;
