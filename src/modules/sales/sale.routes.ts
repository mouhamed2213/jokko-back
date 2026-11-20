import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
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
router.get("/:id", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getSaleById);
router.post("/", protect, authorizeRoles("ADMIN", "EMPLOYEE"), createSale);
router.put("/:id", protect, authorizeRoles("ADMIN"), updateSale);
router.patch(
  "/:id/payment",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  addSalePayment,
);
router.delete("/:id", protect, authorizeRoles("ADMIN"), deleteSale);

export default router;
