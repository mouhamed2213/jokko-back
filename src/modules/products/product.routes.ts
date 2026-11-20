import { Router } from "express";
import { upload } from "../../config/storage.config.js";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
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
  getSuggestedPrice,
);
router.get("/:id", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getProductById);
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
  upload.single("image"),
  updateProduct,
);
router.delete("/:id", protect, authorizeRoles("ADMIN"), deleteProduct);

export default router;
