import { Router } from "express";
import {
  login,
  loginSuperAdmin,
  me,
} from "../controllers/auth.controller.js";
import { authorizeRoles, protect, protectSuperAdmin } from "../middlewares/auth.middleware.js";
import { AccountAuthController } from "../modules/email/account-auth.controller.js";

const router = Router();

router.post("/login", login);
router.post("/super-admin/login", loginSuperAdmin);

// Public account recovery and confirmation routes.
router.post("/forgot-password", AccountAuthController.forgotPassword);
router.post("/password/reset", AccountAuthController.resetPassword);
router.post("/email/verify", AccountAuthController.verifyEmail);
router.post("/email/change/confirm", AccountAuthController.confirmEmailChange);

// Boutique account security routes.
router.get("/email/status", protect, AccountAuthController.emailStatus);
router.post("/email/verification/resend", protect, AccountAuthController.resendVerification);
router.post("/email/change/request", protect, AccountAuthController.requestEmailChange);
router.post("/password/change", protect, AccountAuthController.changePassword);

// Super Admin uses its own JWT and account lookup.
router.get("/super-admin/email/status", protectSuperAdmin, AccountAuthController.superAdminEmailStatus);
router.post("/super-admin/email/verification/resend", protectSuperAdmin, AccountAuthController.resendSuperAdminVerification);
router.post("/super-admin/email/change/request", protectSuperAdmin, AccountAuthController.requestSuperAdminEmailChange);
router.post("/super-admin/password/change", protectSuperAdmin, AccountAuthController.changeSuperAdminPassword);

router.get("/me", protect, authorizeRoles("ADMIN", "EMPLOYEE"), me);

export default router;
