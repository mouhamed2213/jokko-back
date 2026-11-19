import { Router } from "express";
import {
  login,
  loginSuperAdmin,
  me,
} from "../controllers/auth.controller.js";
import { authorizeRoles, protect, protectSuperAdmin } from "../middlewares/auth.middleware.js";
import {
  emailActionRateLimiter,
  emailVerificationRateLimiter,
  invitationRateLimiter,
  loginRateLimiter,
  passwordRecoveryRateLimiter,
  passwordResetRateLimiter,
} from "../middlewares/rate-limit.middleware.js";
import { AccountAuthController } from "../modules/email/account-auth.controller.js";
import { acceptSuperAdminInvitation } from "../modules/email/super-admin-invitation.controller.js";

const router = Router();

// Authentification et invitation : limites appliquées avant les contrôleurs.
router.post("/login", loginRateLimiter, login);
router.post("/super-admin/login", loginRateLimiter, loginSuperAdmin);
router.post("/super-admin/invitation/accept", invitationRateLimiter, acceptSuperAdminInvitation);

// Récupération et confirmation de compte.
router.post("/forgot-password", passwordRecoveryRateLimiter, AccountAuthController.forgotPassword);
router.post("/password/reset", passwordResetRateLimiter, AccountAuthController.resetPassword);
router.post("/email/verify", emailVerificationRateLimiter, AccountAuthController.verifyEmail);
router.post("/email/change/confirm", emailActionRateLimiter, AccountAuthController.confirmEmailChange);

// Sécurité du compte boutique.
router.get("/email/status", protect, AccountAuthController.emailStatus);
router.post("/email/verification/resend", emailActionRateLimiter, protect, AccountAuthController.resendVerification);
router.post("/email/change/request", emailActionRateLimiter, protect, AccountAuthController.requestEmailChange);
router.post("/password/change", emailActionRateLimiter, protect, AccountAuthController.changePassword);

// Sécurité du compte Super Admin.
router.get("/super-admin/email/status", protectSuperAdmin, AccountAuthController.superAdminEmailStatus);
router.post("/super-admin/email/verification/resend", emailActionRateLimiter, protectSuperAdmin, AccountAuthController.resendSuperAdminVerification);
router.post("/super-admin/email/change/request", emailActionRateLimiter, protectSuperAdmin, AccountAuthController.requestSuperAdminEmailChange);
router.post("/super-admin/password/change", emailActionRateLimiter, protectSuperAdmin, AccountAuthController.changeSuperAdminPassword);

router.get("/me", protect, authorizeRoles("ADMIN", "EMPLOYEE"), me);

export default router;
