import { Router } from "express";
import { ContactController } from "../modules/email/contact.controller.js";

const router = Router();
router.post("/", ContactController.send);

export default router;
