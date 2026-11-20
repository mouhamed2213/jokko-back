import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import { SubscriptionController } from "./subscription.controller.js";

const router = Router();

router.get(
  "",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  SubscriptionController.getCurrentSubs,
);
router.patch(
  "/extend",
  protect,
  authorizeRoles("ADMIN"),
  SubscriptionController.extendSubscription,
);

export default router;
