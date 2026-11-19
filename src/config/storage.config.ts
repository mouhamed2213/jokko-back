// ---cut---
import { createClient } from "@supabase/supabase-js";
import { env } from "./env-config.js";
import multer from "multer";

// console.log(env)
export const LOGO_BUCKET = "logos"
export const PRODUCT_BUCKET = "products"

//  Supabase client
export const supabase = createClient(
  env.storage.superbaseUrl,
  env.storage.superbaseSecretKey,
);

//  multer
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // Limite stricte de 5 Mo pour éviter la saturation mémoire
  },
});

