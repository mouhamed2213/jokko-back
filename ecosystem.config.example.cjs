module.exports = {
  apps: [
    {
      name: 'jokko-business-api',
      script: './dist/index.js',
      // Note architecture SSE & Tâches de fond :
      // Les notifications SSE reposent sur un Store en mémoire vive (Map locale).
      // Le mode 'fork' (1 instance) est recommandé par défaut tant qu'un adaptateur
      // Redis Pub/Sub n'est pas branché pour diffuser les alertes de stock inter-instances.
      // La tâche planifiée d'expiration d'abonnements est protégée et s'exécute uniquement
      // sur le worker principal (NODE_APP_INSTANCE === '0').
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,              // Redémarrage automatique en cas de crash
      watch: false,                   // Désactivé en production
      max_memory_restart: '1G',       // Redémarre le processus si la mémoire dépasse 1 Go

      // Fichiers de logs
      output: './logs/pm2-out.log',
      error: './logs/pm2-error.log',
      merge_logs: true,

      // Variables d'environnement de PRODUCTION
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        SERVER: 'https://api.jokko-business.com',
        FRONTEND_URL: 'https://www.jokko-business.com',
        DATABASE_URL: 'postgresql://prod_user:StrongPassword123@127.0.0.1:5432/prod_db?schema=public',
        DIRECT_URL: 'postgresql://prod_user:StrongPassword123@127.0.0.1:5432/prod_db?schema=public',
        JWT_SECRET: 'd8a7c6b5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5',
        LOG_LEVEL: 'warn',

        // Supabase / Storage
        SUPABASE_URL: 'https://xyz.supabase.co',
        SUPABASE_SECRET_KEY: 'sb_secret_key_production_vault',
        ADMIN_EMAIL: 'admin@jokko-business.com',
        ADMIN_PASSWORD: 'StrongAdminPassword123',

        // Configuration Mail (Mailtrap / SMTP)
        MAILTRAP_TOKEN: 'your_mailtrap_token_here',
        MAILTRAP_FROM_EMAIL: 'contact@jokko-business.com',
        MAILTRAP_FROM_NAME: 'Jokko Business',
        MAILTRAP_CONTACT_EMAIL: 'contact@jokko-business.com'
      }
    }
  ]
};