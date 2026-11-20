import { Router } from "express";
import { upload } from "../../config/storage.config.js";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import { validateNumericParams } from "../../middlewares/validate.middleware.js";
import {
  createProduct,
  deleteProduct,
  getLowStockProducts,
  getOutOfStockProducts,
  getProductById,
  getProducts,
  getSuggestedPrice,
  updateProduct,
} from "./product.controller.js";

const router = Router();

router.get("/", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getProducts);
router.get(
  "/low-stock",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getLowStockProducts,
);
router.get(
  "/out-of-stock",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getOutOfStockProducts,
);
router.get(
  "/:id/price",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateNumericParams("id"),
  getSuggestedPrice,
);
router.get(
  "/:id",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  validateNumericParams("id"),
  getProductById,
);
router.post(
  "/",
  protect,
  authorizeRoles("ADMIN"),
  upload.single("image"),
  createProduct,
);
router.put(
  "/:id",
  protect,
  authorizeRoles("ADMIN"),
  validateNumericParams("id"),
  upload.single("image"),
  updateProduct,
);
router.delete(
  "/:id",
  protect,
  authorizeRoles("ADMIN"),
  validateNumericParams("id"),
  deleteProduct,
);

export default router;
