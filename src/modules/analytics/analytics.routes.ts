import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import {
  getOverview,
  getProducts,
  getSales,
  getStock,
  getCustomers,
  getCash,
  getTrends,
  getInsights,
} from "./analytics.controller.js";

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
router.get("/stock", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getStock);
router.get(
  "/customers",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getCustomers,
);
router.get("/cash", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getCash);
router.get(
  "/trends",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getTrends,
);
router.get(
  "/insights",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getInsights,
);

export default router;
