import { randomUUID } from "node:crypto";
import { BadRequestError } from "./errors.js";
import { env } from "../config/env-config.js";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 Mo
export const SUPABASE_PUBLIC_BUCKETS_URL = env.storage.publicBucketsUrl;
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/svg",
  "image/png",
  "image/webp",
  "application/pdf",
];

export function getFullStorageUrl(
  bucket: string,
  relativePath: string | null,
): string | null {
  if (!relativePath) return null;
  if (
    relativePath.startsWith("http://") ||
    relativePath.startsWith("https://")
  ) {
    return relativePath;
  }
  return `${SUPABASE_PUBLIC_BUCKETS_URL}/${bucket}/${relativePath}`;
}

// file Validator
export const validateFile = (file: Express.Multer.File): void => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new BadRequestError(
      "Format non supporté. Utilisez une image JPG, PNG, SVG ou WebP.",
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new BadRequestError("Le fichier dépasse la taille maximale de 5 Mo.");
  }
};
export const cleanPath = (file: Express.Multer.File): string => {
  const rawExt = file.originalname ? file.originalname.split(".").pop() : "png";
  const safeExt = (rawExt ? rawExt.replace(/[^a-zA-Z0-9]/g, "") : "png") || "png";
  const path = `${Date.now()}-${randomUUID()}.${safeExt}`;

  return path;
};
