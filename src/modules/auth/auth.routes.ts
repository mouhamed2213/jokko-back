import { Router } from "express";
import {
  authorizeRoles,
  protect,
  protectSuperAdmin,
} from "../../middlewares/auth.middleware.js";
import {
  emailActionRateLimiter,
  emailVerificationRateLimiter,
  invitationRateLimiter,
  loginRateLimiter,
  passwordRecoveryRateLimiter,
  passwordResetRateLimiter,
} from "../../middlewares/rate-limit.middleware.js";
import { AccountAuthController } from "../email/account-auth.controller.js";
import { acceptSuperAdminInvitation } from "../email/super-admin-invitation.controller.js";
import { login, loginSuperAdmin, me } from "./auth.controller.js";

const router = Router();

router.post("/login", loginRateLimiter, login);
router.post("/super-admin/login", loginRateLimiter, loginSuperAdmin);
router.post(
  "/super-admin/invitation/accept",
  invitationRateLimiter,
  acceptSuperAdminInvitation,
);

router.post(
  "/forgot-password",
  passwordRecoveryRateLimiter,
  AccountAuthController.forgotPassword,
);
router.post(
  "/password/reset",
  passwordResetRateLimiter,
  AccountAuthController.resetPassword,
);
router.post(
  "/email/verify",
  emailVerificationRateLimiter,
  AccountAuthController.verifyEmail,
);
router.post(
  "/email/change/confirm",
  emailActionRateLimiter,
  AccountAuthController.confirmEmailChange,
);

router.get("/email/status", protect, AccountAuthController.emailStatus);
router.post(
  "/email/verification/resend",
  emailActionRateLimiter,
  protect,
  AccountAuthController.resendVerification,
);
router.post(
  "/email/change/request",
  emailActionRateLimiter,
  protect,
  AccountAuthController.requestEmailChange,
);
router.post(
  "/password/change",
  emailActionRateLimiter,
  protect,
  AccountAuthController.changePassword,
);

router.get(
  "/super-admin/email/status",
  protectSuperAdmin,
  AccountAuthController.superAdminEmailStatus,
);
router.post(
  "/super-admin/email/verification/resend",
  emailActionRateLimiter,
  protectSuperAdmin,
  AccountAuthController.resendSuperAdminVerification,
);
router.post(
  "/super-admin/email/change/request",
  emailActionRateLimiter,
  protectSuperAdmin,
  AccountAuthController.requestSuperAdminEmailChange,
);
router.post(
  "/super-admin/password/change",
  emailActionRateLimiter,
  protectSuperAdmin,
  AccountAuthController.changeSuperAdminPassword,
);

router.get("/me", protect, authorizeRoles("ADMIN", "EMPLOYEE"), me);

export default router;
