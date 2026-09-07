import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import { getOverview, getSales } from "./analytics.controller.js";

const router = Router();

router.get(
  "/overview",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getOverview,
);
router.get("/sales", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getSales);

export default router;
