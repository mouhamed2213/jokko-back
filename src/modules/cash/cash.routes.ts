import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import {
  validateBody,
  validateNumericParams,
} from "../../middlewares/validate.middleware.js";
import {
  addTransaction,
  closeCash,
  getCashById,
  getCashHistory,
  getCurrentCash,
  openCash,
} from "./cash.controller.js";

const router = Router();

router.get(
  "/current",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getCurrentCash,
);
router.get(
  "/history",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getCashHistory,
);
router.get(
  "/:id",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateNumericParams("id"),
  getCashById,
);
router.post(
  "/open",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateBody({
    openingAmount: {
      type: "number",
      required: true,
      min: 0,
      label: "Montant d'ouverture",
    },
  }),
  openCash,
);
router.patch(
  "/:id/close",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateNumericParams("id"),
  closeCash,
);
router.post(
  "/transactions",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateBody({
    type: { type: "enum", required: true, values: ["IN", "OUT"], label: "Type" },
    amount: { type: "number", required: true, min: 1, label: "Montant" },
    label: { type: "string", required: true, label: "Libellé" },
  }),
  addTransaction,
);

export default router;
