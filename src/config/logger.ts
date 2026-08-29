import { createLogger, format, transports } from "winston";
import path from "path";
import fs from "fs";
import { env } from "./env-config.js";

// Créer le dossier logs s'il n'existe pas
const logDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const { combine, timestamp, printf, colorize, errors } = format;

// Format console — coloré et lisible
const consoleFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `${timestamp} [${level}] ${stack || message}${metaStr}`;
});

// Format fichier — JSON structuré
const fileFormat = combine(
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  format.json()
);

export const logger = createLogger({
  level: env.log.LogLevel,
  transports: [
    // Console — développement
    new transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: "HH:mm:ss" }),
        errors({ stack: true }),
        consoleFormat
      ),
    }),

    // Fichier erreurs uniquement
    new transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
      format: fileFormat,
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
    }),

    // Fichier toutes les logs
    new transports.File({
      filename: path.join(logDir, "combined.log"),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10,
    }),
  ],
});

// Stream pour Morgan (logs HTTP)
export const morganStream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};