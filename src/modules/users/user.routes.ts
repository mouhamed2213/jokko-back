import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import {
  createUser,
  deleteUser,
  getUsers,
  updateUser,
} from "./user.controller.js";

const router = Router();

router.get("/", protect, authorizeRoles("ADMIN"), getUsers);
router.post("/", protect, authorizeRoles("ADMIN"), createUser);
router.put("/:id", protect, authorizeRoles("ADMIN"), updateUser);
router.delete("/:id", protect, authorizeRoles("ADMIN"), deleteUser);

export default router;
