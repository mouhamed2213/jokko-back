import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import { getOverview, getProducts, getSales } from "./analytics.controller.js";

const router = Router();

router.get(
  "/overview",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getOverview,
);
router.get("/sales", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getSales);
router.get(
  "/products",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getProducts,
);

export default router;
