import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import {
  validateBody,
  validateNumericParams,
} from "../../middlewares/validate.middleware.js";
import {
  addInvoicePayment,
  getInvoiceById,
  getInvoices,
} from "./invoice.controller.js";

const router = Router();

router.get("/", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getInvoices);
router.get(
  "/:id",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateNumericParams("id"),
  getInvoiceById,
);
router.patch(
  "/:id/payment",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateNumericParams("id"),
  validateBody({
    amount: { type: "number", required: false, min: 1, label: "Montant" },
  }),
  addInvoicePayment,
);

export default router;
