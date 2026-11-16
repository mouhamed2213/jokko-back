CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "maintenanceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMessage" TEXT NOT NULL DEFAULT 'Jokko Business est temporairement indisponible pour maintenance. Nous serons de retour très bientôt.',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);
