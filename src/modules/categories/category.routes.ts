import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import {
  validateBody,
  validateNumericParams,
} from "../../middlewares/validate.middleware.js";
import {
  createCategory,
  deleteCategory,
  getCategories,
} from "./category.controller.js";

const router = Router();

router.get("/", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getCategories);
router.post(
  "/",
  protect,
  authorizeRoles("ADMIN"),
  validateBody({ name: { type: "string", required: true, label: "Nom" } }),
  createCategory,
);
router.delete(
  "/:id",
  protect,
  authorizeRoles("ADMIN"),
  validateNumericParams("id"),
  deleteCategory,
);

export default router;
