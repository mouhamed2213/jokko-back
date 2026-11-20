import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import {
  addInvoicePayment,
  getInvoiceById,
  getInvoices,
} from "./invoice.controller.js";

const router = Router();

router.get("/", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getInvoices);
router.get("/:id", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getInvoiceById);
router.patch(
  "/:id/payment",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  addInvoicePayment,
);

export default router;
