import { Router } from "express";
import { SubscriptionController } from "../controllers/subscription.controller.js";
import { authorizeRoles, protect } from "../middlewares/auth.middleware.js";

const router = Router();

router.get(
  "",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  SubscriptionController.getCurrentSubs,
);
router.patch(
  "extend",
  protect,
  authorizeRoles["ADMIN"],
  SubscriptionController.extendSubscription,
);

export default router;
