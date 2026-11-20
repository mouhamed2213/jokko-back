import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import { requireFeature } from "../../middlewares/feature.middleware.js";
import {
  validateBody,
  validateNumericParams,
} from "../../middlewares/validate.middleware.js";
import {
  addSupplierDebt,
  addSupplierPayment,
  createSupplier,
  deleteSupplier,
  getConsolidatedSuppliers,
  getSupplierById,
  getSupplierDebtAging,
  getSupplierProducts,
  getSupplierQuota,
  getSupplierRanking,
  getSuppliers,
  updateSupplier,
} from "./supplier.controller.js";

const router = Router();

router.get("/", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getSuppliers);
router.get(
  "/quota",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getSupplierQuota,
);
router.get(
  "/aging",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getSupplierDebtAging,
);
router.get(
  "/analytics/ranking",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  requireFeature("ADVANCED_REPORTS"),
  getSupplierRanking,
);
router.get(
  "/analytics/products",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  requireFeature("ADVANCED_REPORTS"),
  getSupplierProducts,
);
router.get(
  "/consolidated",
  protect,
  authorizeRoles("ADMIN"),
  requireFeature("MULTI_STORE"),
  getConsolidatedSuppliers,
);
router.get(
  "/:id",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateNumericParams("id"),
  getSupplierById,
);
router.post(
  "/",
  protect,
  authorizeRoles("ADMIN"),
  validateBody({ name: { type: "string", required: true, label: "Nom" } }),
  createSupplier,
);
router.put(
  "/:id",
  protect,
  authorizeRoles("ADMIN"),
  validateNumericParams("id"),
  updateSupplier,
);
router.delete(
  "/:id",
  protect,
  authorizeRoles("ADMIN"),
  validateNumericParams("id"),
  deleteSupplier,
);
router.post(
  "/:id/debts",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateNumericParams("id"),
  validateBody({
    totalAmount: {
      type: "number",
      required: true,
      min: 1,
      label: "Montant total",
    },
  }),
  addSupplierDebt,
);
router.post(
  "/:id/debts/:debtId/payments",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateNumericParams("id", "debtId"),
  validateBody({
    amount: { type: "number", required: true, min: 1, label: "Montant" },
  }),
  addSupplierPayment,
);

export default router;
