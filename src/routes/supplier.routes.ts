import { Router } from "express";
import {
  getSuppliers, getSupplierById, createSupplier,
  updateSupplier, deleteSupplier,
  addSupplierDebt, addSupplierPayment,
  getSupplierQuota, getSupplierDebtAging,
} from "../controllers/supplier.controller.js";
import { protect, authorizeRoles } from "../middlewares/auth.middleware.js";

const router = Router();

router.get("/", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getSuppliers);
router.get("/quota", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getSupplierQuota);
router.get("/aging", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getSupplierDebtAging);
router.get("/:id", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getSupplierById);
router.post("/", protect, authorizeRoles("ADMIN"), createSupplier);
router.put("/:id", protect, authorizeRoles("ADMIN"), updateSupplier);
router.delete("/:id", protect, authorizeRoles("ADMIN"), deleteSupplier);
router.post("/:id/debts", protect, authorizeRoles("ADMIN", "EMPLOYEE"), addSupplierDebt);
router.post("/:id/debts/:debtId/payments", protect, authorizeRoles("ADMIN", "EMPLOYEE"), addSupplierPayment);

export default router;