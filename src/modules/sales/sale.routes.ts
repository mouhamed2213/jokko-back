import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import {
  validateBody,
  validateNumericParams,
} from "../../middlewares/validate.middleware.js";
import {
  addSalePayment,
  createSale,
  deleteSale,
  getSaleById,
  getSales,
  updateSale,
} from "./sale.controller.js";

const router = Router();

router.get("/", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getSales);
router.get(
  "/:id",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateNumericParams("id"),
  getSaleById,
);
router.post(
  "/",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateBody({
    items: { type: "array", required: true, minLength: 1, label: "Articles" },
  }),
  createSale,
);
router.put(
  "/:id",
  protect,
  authorizeRoles("ADMIN"),
  validateNumericParams("id"),
  validateBody({
    items: { type: "array", required: true, minLength: 1, label: "Articles" },
  }),
  updateSale,
);
router.patch(
  "/:id/payment",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateNumericParams("id"),
  validateBody({
    amount: { type: "number", required: false, min: 1, label: "Montant" },
  }),
  addSalePayment,
);
router.delete(
  "/:id",
  protect,
  authorizeRoles("ADMIN"),
  validateNumericParams("id"),
  deleteSale,
);

export default router;
