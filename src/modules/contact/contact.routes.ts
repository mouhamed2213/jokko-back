import { Router } from "express";
import { contactRateLimiter } from "../../middlewares/rate-limit.middleware.js";
import { ContactController } from "../email/contact.controller.js";

const router = Router();

router.post("/", contactRateLimiter, ContactController.send);

export default router;
