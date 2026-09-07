import cors from "cors";
import express, { Request, Response } from "express";
// import 'express-async-errors';
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env-config.js";
import { logger, morganStream } from "./config/logger.js";
import { ErrorHandler } from "./middlewares/error-handler.middleware.js";
import authRoutes from "./routes/auth.routes.js";
import cashRoutes from "./routes/cash.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import clientRoutes from "./routes/client.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import invoiceRoutes from "./routes/invoice.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import productRoutes from "./routes/product.routes.js";
import saleRoutes from "./routes/sale.routes.js";
import shopRoutes from "./routes/shop.routes.js";
import stockRoutes from "./routes/stock.routes.js";
import subscription from "./routes/subscription.routes.js";
import superAdminRoutes from "./modules/super-admin/super-admin.routes.js";
import supplierRoutes from "./routes/supplier.routes.js";
import userRoutes from "./routes/user.routes.js";
import analyticsRoutes from "./modules/analytics/analytics.routes.js";

const app = express();
// const PORT = Number(env.PORT) || 5000;

 
app.use(express.json());
const origins = [
  'https://jokko-business.com',
  'https://www.jokko-business.com',
  'http://localhost:4200',
  'http://localhost:5173'
];
const allowedOrigins = env.mode === 'production' ? origins : '*';

console.log('Allowed Origins:', allowedOrigins);
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

app.listen(env.port, () => {
  logger.info(`✅ Jokko Business API démarrée sur ${env.server}:${env.port}`);
  logger.info(`🌍 Environnement : ${env.mode}`);
});
