module.exports = {
  apps: [
    {
      name: 'mon-application-api',
      script: './dist/index.js',
      instances: 'max',               // Déploie 1 instance par cœur CPU disponible
      exec_mode: 'cluster',           // Mode cluster pour la haute disponibilité
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

        // Configuration Mail
        MAIL_HOST: 'smtp.sendgrid.net',
        MAIL_PORT: 587,
        MAIL_USER: 'apikey',
        MAIL_PASSWORD: 'SG.production_smtp_key_here',
        MAIL_FROM: 'noreply@jokko-business.com'
      }
    }
  ]
};