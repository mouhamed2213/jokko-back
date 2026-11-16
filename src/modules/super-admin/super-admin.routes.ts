import { Router } from "express";
import { protectSuperAdmin } from "../../middlewares/auth.middleware.js";
import { SuperAdminShopController } from "./controllers/super-admin.controller.js";
import { SuperAdminManagementController } from "./controllers/super-admin-management.controller.js";

const router = Router();

// Toutes les routes /api/super-admin/* sont réservées aux Super Admins.
router.use(protectSuperAdmin);

router.get("/me", SuperAdminShopController.me);

// Gestion des comptes Super Admin (toutes ces routes sont protégées par le middleware global).
router.get("/admins", SuperAdminManagementController.list);
router.post("/admins/invitations", SuperAdminManagementController.invite);
router.post("/admins/:id/invitation/resend", SuperAdminManagementController.resendInvitation);
router.patch("/admins/:id/status", SuperAdminManagementController.setActive);
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
router.patch("/subscription/payments/:paymentId/confirm", SuperAdminShopController.confirmSubscriptionPayment);
router.patch("/subscription/payments/:paymentId/cancel", SuperAdminShopController.cancelSubscriptionPayment);

router.patch(
  "/shops/:shopId/subscription/status",
  SuperAdminShopController.updateSubscriptionStatus,
);
router.patch(
  "/shops/:shopId/subscription/extend",
  SuperAdminShopController.extendTrialPeriod,
);

export default router;
