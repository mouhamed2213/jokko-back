import { Router } from "express";
import { upload } from "../../config/storage.config.js";
import { authorizeRoles, protect } from "../../middlewares/auth.middleware.js";
import {
  createSecondShop,
  createShop,
  deleteShopLogo,
  getShops,
  getShopSettings,
  switchShop,
  updateShopSettings,
  uploadShopLogo,
} from "./shop.controller.js";

const router = Router();

router.post("/", createShop);
router.post(
  "/create-second-shop",
  protect,
  authorizeRoles("ADMIN"),
  createSecondShop,
);
router.get("/", protect, authorizeRoles("ADMIN", "EMPLOYEE"), getShops);
router.post("/switch", protect, authorizeRoles("ADMIN"), switchShop);
router.get(
  "/settings",
  protect,
  authorizeRoles("ADMIN", "EMPLOYEE"),
  getShopSettings,
);
router.put("/settings", protect, authorizeRoles("ADMIN"), updateShopSettings);
router.post(
  "/logo",
  protect,
  authorizeRoles("ADMIN"),
  upload.single("logo"),
  uploadShopLogo,
);
router.delete("/logo", protect, authorizeRoles("ADMIN"), deleteShopLogo);

export default router;
