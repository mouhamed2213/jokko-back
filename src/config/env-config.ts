import dotenv from "dotenv";

// Charge le fichier .env s'il existe (en local)
// Sur VPS, si .env n'existe pas, il utilise directement process.env
dotenv.config();

const data = process.env;

export const env = {
  server: data.SERVER || "http://localhost",
  port: Number(data.PORT) || 5000,
  logLevel: data.LOG_LEVEL || "info",
  db: {
    url: data.DATABASE_URL!,
    directUrl: data.DIRECT_URL!,
  },
  secret: {
    jwt: data.JWT_SECRET!,
  },
  storage: {
    superbaseUrl: data.SUPABASE_URL!,
    superbaseSecretKey: data.SUPABASE_SECRET_KEY!,
    publicBucketsUrl: `${data.SUPABASE_URL}/storage/v1/object/public`,
  },
  mail: {
    host: data.MAIL_HOST,
    port: Number(data.MAIL_PORT) || 2525,
    user: data.MAIL_USER,
    password: data.MAIL_PASSWORD,
    from: data.MAIL_FROM,
  },
  frontendUrl: data.FRONTEND_URL,
  mode: data.NODE_ENV || "development",
};