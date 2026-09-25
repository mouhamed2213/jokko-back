import { Router } from "express";
import { protectSuperAdmin } from "../../middlewares/auth.middleware.js";
import { SuperAdminShopController } from "./controllers/super-admin.controller.js";

const router = Router();

// Toutes les routes /api/super-admin/* sont réservées aux Super Admins.
router.use(protectSuperAdmin);

router.get("/stats", SuperAdminShopController.getStats);
router.get("/shops", SuperAdminShopController.listShops);
router.get("/shops/:id", SuperAdminShopController.getShopDetail);

// Subscription management

router.post("/subscription", SuperAdminShopController.subscription);

router.patch(
  "/shops/:shopId/subscription/status",
  SuperAdminShopController.updateSubscriptionStatus,
);
router.patch(
  "/shops/:shopId/subscription/extend",
  SuperAdminShopController.extendTrialPeriod,
);

export default router;
