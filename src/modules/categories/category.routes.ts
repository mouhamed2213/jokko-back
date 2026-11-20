import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import {
  createCategory,
  deleteCategory,
  getCategories,
} from "./category.controller.js";

const router = Router();

router.get("/", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getCategories);
router.post("/", protect, authorizeRoles("ADMIN"), createCategory);
router.delete("/:id", protect, authorizeRoles("ADMIN"), deleteCategory);

export default router;
