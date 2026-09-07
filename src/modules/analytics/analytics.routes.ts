import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import {
  getOverview,
  getMultiStoreOverview,
  getProducts,
  getSales,
  getStock,
  getCustomers,
  getCash,
  getTrends,
  getInsights,
} from "./analytics.controller.js";
import {
  requireAnalyticsAccess,
  requireMultiStoreAnalytics,
} from "./analytics-access.middleware.js";

const router = Router();

router.get(
  "/overview",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  requireAnalyticsAccess("overview"),
  getOverview,
);
router.get(
  "/overview/multi-store",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  requireMultiStoreAnalytics,
  getMultiStoreOverview,
);
router.get("/sales", protect, authorizeRoles("ADMIN", "EMPLOYEE"), requireAnalyticsAccess("sales"), getSales);
router.get(
  "/products",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  requireAnalyticsAccess("products"),
  getProducts,
);
router.get("/stock", protect, authorizeRoles("ADMIN", "EMPLOYEE"), requireAnalyticsAccess("stock"), getStock);
router.get(
  "/customers",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  requireAnalyticsAccess("customers"),
  getCustomers,
);
router.get("/cash", protect, authorizeRoles("ADMIN", "EMPLOYEE"), requireAnalyticsAccess("cash"), getCash);
router.get(
  "/trends",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  requireAnalyticsAccess("trends"),
  getTrends,
);
router.get(
  "/insights",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  requireAnalyticsAccess("insights"),
  getInsights,
);

export default router;
