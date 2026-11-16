import { prisma } from "../../config/prisma.js";

const DEFAULT_MESSAGE = "Jokko Business est temporairement indisponible pour maintenance. Nous serons de retour très bientôt.";

export const MaintenanceService = {
  getStatus: async () => {
    const settings = await prisma.platformSetting.findUnique({
      where: { id: "global" },
    });
    return {
      enabled: settings?.maintenanceEnabled ?? false,
      message: settings?.maintenanceMessage ?? DEFAULT_MESSAGE,
      updatedAt: settings?.updatedAt ?? null,
    };
  },

  update: async (enabled: boolean, message: string) => {
    const normalizedMessage = message.trim() || DEFAULT_MESSAGE;
    const settings = await prisma.platformSetting.upsert({
      where: { id: "global" },
      create: {
        id: "global",
        maintenanceEnabled: enabled,
        maintenanceMessage: normalizedMessage,
      },
      update: {
        maintenanceEnabled: enabled,
        maintenanceMessage: normalizedMessage,
      },
    });
    return {
      enabled: settings.maintenanceEnabled,
      message: settings.maintenanceMessage,
      updatedAt: settings.updatedAt,
    };
  },
};
