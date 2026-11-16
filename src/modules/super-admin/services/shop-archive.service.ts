import { prisma } from "../../../config/prisma.js";
import {
  SHOP_STATUS,
  invalidateShopStatusCache,
} from "../../../helpers/shop-status.js";
import { logAuditAction } from "../../../helpers/audit-logger.js";
import { ConflictError, NotFoundError } from "../../../utils/errors.js";

type Actor = { actorId: number; actorName: string };

/**
 * Archivage d'une boutique (suppression douce, réversible).
 * Aucune donnée n'est supprimée : la boutique ne peut simplement plus se connecter.
 */
export const ShopArchiveService = {
  archive: async (shopId: number, actor: Actor) => {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
      },
    });
    if (!shop) throw new NotFoundError("Boutique introuvable");

    if (shop.status === SHOP_STATUS.ARCHIVED) {
      throw new ConflictError("Cette boutique est déjà archivée");
    }

    // Les boutiques secondaires restent dans leur état individuel.
    // Leur accès est bloqué tant que la boutique principale est archivée.

    // Garde atomique : ne passe que si la boutique n'a pas été archivée entre-temps
    const result = await prisma.shop.updateMany({
      where: { id: shopId, status: { not: SHOP_STATUS.ARCHIVED } },
      data: { status: SHOP_STATUS.ARCHIVED },
    });
    if (result.count === 0) {
      throw new ConflictError("Cette boutique est déjà archivée");
    }

    invalidateShopStatusCache(shopId);

    await logAuditAction({
      ...actor,
      action: "ARCHIVE_SHOP",
      targetType: "Shop",
      targetId: shopId,
      details: { name: shop.name, email: shop.email, previousStatus: shop.status },
    });

    return { id: shop.id, name: shop.name, status: SHOP_STATUS.ARCHIVED };
  },

  restore: async (shopId: number, actor: Actor) => {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        primaryShop: { select: { id: true, name: true, status: true } },
      },
    });
    if (!shop) throw new NotFoundError("Boutique introuvable");

    if (shop.status !== SHOP_STATUS.ARCHIVED) {
      throw new ConflictError("Cette boutique n'est pas archivée");
    }

    // Une secondaire ne peut pas être restaurée tant que sa principale est archivée
    if (shop.primaryShop?.status === SHOP_STATUS.ARCHIVED) {
      throw new ConflictError(
        `Restaurez d'abord la boutique principale : ${shop.primaryShop.name}`,
      );
    }

    const result = await prisma.shop.updateMany({
      where: { id: shopId, status: SHOP_STATUS.ARCHIVED },
      data: { status: SHOP_STATUS.ACTIVE },
    });
    if (result.count === 0) {
      throw new ConflictError("Cette boutique n'est pas archivée");
    }

    invalidateShopStatusCache(shopId);

    await logAuditAction({
      ...actor,
      action: "RESTORE_SHOP",
      targetType: "Shop",
      targetId: shopId,
      details: { name: shop.name, email: shop.email },
    });

    return { id: shop.id, name: shop.name, status: SHOP_STATUS.ACTIVE };
  },
};
