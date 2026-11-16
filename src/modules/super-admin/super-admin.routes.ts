import { Router } from "express";
import { protectSuperAdmin } from "../../middlewares/auth.middleware.js";
import { SuperAdminShopController } from "./controllers/super-admin.controller.js";

const router = Router();

// Toutes les routes /api/super-admin/* sont réservées aux Super Admins.
router.use(protectSuperAdmin);

router.get("/me", SuperAdminShopController.me);
router.get("/stats", SuperAdminShopController.getStats);
router.get("/shops", SuperAdminShopController.listShops);
router.get("/shops/:id", SuperAdminShopController.getShopDetail);

// Propriétaires (lecture seule)
router.get("/owners", SuperAdminShopController.listOwners);
router.get("/owners/:id", SuperAdminShopController.getOwnerDetail);

// Archivage (suppression douce, réversible)
router.patch("/shops/:id/archive", SuperAdminShopController.archiveShop);
router.patch("/shops/:id/restore", SuperAdminShopController.restoreShop);

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
