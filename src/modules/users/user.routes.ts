import { Router } from "express";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import {
  validateBody,
  validateNumericParams,
} from "../../middlewares/validate.middleware.js";
import {
  createUser,
  deleteUser,
  getUsers,
  updateUser,
} from "./user.controller.js";

const router = Router();

router.get("/", protect, authorizeRoles("ADMIN"), getUsers);
router.post(
  "/",
  protect,
  authorizeRoles("ADMIN"),
  validateBody({
    name: { type: "string", required: true, label: "Nom" },
    email: { type: "email", required: true, label: "Email" },
    password: { type: "string", required: true, minLength: 6, label: "Mot de passe" },
  }),
  createUser,
);
router.put(
  "/:id",
  protect,
  authorizeRoles("ADMIN"),
  validateNumericParams("id"),
  updateUser,
);
router.delete(
  "/:id",
  protect,
  authorizeRoles("ADMIN"),
  validateNumericParams("id"),
  deleteUser,
);

export default router;
