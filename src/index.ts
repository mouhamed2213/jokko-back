import cors from "cors";
import express, { Request, Response } from "express";
// import 'express-async-errors';
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env-config.js";
import { logger, morganStream } from "./config/logger.js";
import { ErrorHandler } from "./middlewares/error-handler.middleware.js";
import { apiRateLimiter } from "./middlewares/rate-limit.middleware.js";
import authRoutes from "./routes/auth.routes.js";
import contactRoutes from "./modules/contact/contact.routes.js";
import cashRoutes from "./modules/cash/cash.routes.js";
import categoryRoutes from "./modules/categories/category.routes.js";
import clientRoutes from "./modules/clients/client.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import invoiceRoutes from "./modules/invoices/invoice.routes.js";
import notificationRoutes from "./modules/notifications/notification.routes.js";
import productRoutes from "./modules/products/product.routes.js";
import saleRoutes from "./modules/sales/sale.routes.js";
import shopRoutes from "./routes/shop.routes.js";
import stockRoutes from "./modules/stock/stock.routes.js";
import subscription from "./routes/subscription.routes.js";
import superAdminRoutes from "./modules/super-admin/super-admin.routes.js";
import supplierRoutes from "./routes/supplier.routes.js";
import userRoutes from "./modules/users/user.routes.js";
import analyticsRoutes from "./modules/analytics/analytics.routes.js";
import maintenanceRoutes from "./modules/maintenance/maintenance.routes.js";
import { maintenanceMiddleware } from "./modules/maintenance/maintenance.middleware.js";
import { SubscriptionLifecycleService } from "./services/subscription-lifecycle.service.js";

const app = express();

// À configurer uniquement si l'API est derrière un reverse proxy connu.
if (env.trustProxyHops > 0) {
  app.set("trust proxy", env.trustProxyHops);
}

// Limite globale avant le parsing JSON pour protéger aussi les ressources serveur.
app.use("/api", apiRateLimiter);

app.use(express.json());
const origins = [
  'https://jokko-business.com',
  'https://www.jokko-business.com',
  'http://localhost:4200',
  'http://localhost:5173'
];
const allowedOrigins = env.mode === 'production' ? origins : '*';

logger.info(`Allowed Origins: ${JSON.stringify(allowedOrigins)}`);
app.use(
  cors({
    origin: env.mode=== 'production' ? (origin, callback) => {
      // Autoriser les requêtes sans origine (ex: Postman ou requêtes serveur à serveur)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Bloqué par CORS'));
      }
    } : "*",
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
    exposedHeaders: ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After"],
  })
);

app.use(
  morgan(env.mode === "production" ? "combined" : "dev", {
    stream: morganStream,
  }),
);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Jokko Business API v1.0", status: "running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/super-admin", superAdminRoutes);
app.use("/api/maintenance", maintenanceRoutes);

// Bloque les API applicatives pendant la maintenance, sans bloquer
// l’authentification ni les routes Super Admin nécessaires à sa désactivation.
app.use("/api", maintenanceMiddleware);
app.use("/api/contact", contactRoutes);
app.use("/api/users", userRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/sales", saleRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/cash", cashRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/shop", shopRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/subscription", subscription);
app.use("/api/analytics", analyticsRoutes);

app.use((req: Request, res: Response) => {
  logger.warn(`404 — Route non trouvée : ${req.method} ${req.originalUrl}`);
  res.status(404).json({ message: `Route non trouvée : ${req.originalUrl}` });
});

// Global Error handler
app.use(ErrorHandler);

const runSubscriptionExpirationJob = () => {
  SubscriptionLifecycleService.processExpiredSubscriptions()
    .then(({ checked, downgraded }) => {
      if (downgraded > 0) {
        logger.info(`Subscription expiration job: ${downgraded}/${checked} boutique(s) rétrogradée(s) vers Essentielle.`);
      }
    })
    .catch((error) => logger.error("Subscription expiration job failed", error));
};

// Rattrapage au démarrage, puis vérification périodique toutes les 15 minutes.
// Protection cluster : n'exécute la tâche planifiée que sur l'instance principale (instance 0 sous PM2)
// afin d'éviter les exécutions concurrentes redondantes en base de données.
const isPrimaryWorker =
  !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === "0";

if (isPrimaryWorker) {
  runSubscriptionExpirationJob();
  setInterval(runSubscriptionExpirationJob, 15 * 60 * 1000);
}

app.listen(env.port, () => {
  logger.info(`✅ Jokko Business API démarrée sur ${env.server}:${env.port}`);
  logger.info(`🌍 Environnement : ${env.mode}`);
});
