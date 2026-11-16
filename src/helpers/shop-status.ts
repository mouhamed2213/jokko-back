import { logger } from "../config/logger.js";
import { prisma } from "../config/prisma.js";

export const SHOP_STATUS = {
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
} as const;

/**
 * Statuts qui bloquent l'accès d'une boutique (connexion + sessions ouvertes).
 * Volontairement une liste explicite : tout autre statut (ACTIVE, SUSPENDED
 * saisi à la main, etc.) garde le comportement actuel.
 */
export const BLOCKED_SHOP_STATUSES: string[] = [SHOP_STATUS.ARCHIVED];

export const isBlockedStatus = (status?: string | null) =>
  !!status && BLOCKED_SHOP_STATUSES.includes(status);

// Cache court pour ne pas ajouter une requête SQL à chaque appel API.
// Propre à chaque processus (PM2 cluster) : effet maximal ≈ TTL sur les autres workers.
const TTL_MS = 30_000;
const cache = new Map<number, { blocked: boolean; expiresAt: number }>();

export const invalidateShopStatusCache = (shopId: number) => {
  cache.delete(shopId);
};

/**
 * Indique si la boutique est bloquée (archivée).
 * Ne lève jamais d'erreur : en cas de problème base de données on laisse passer
 * (fail-open) pour ne jamais déconnecter des utilisateurs à cause de ce contrôle.
 */
export const isShopBlocked = async (shopId: number): Promise<boolean> => {
  const now = Date.now();
  const hit = cache.get(shopId);
  if (hit && hit.expiresAt > now) return hit.blocked;

  try {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        status: true,
        primaryShop: { select: { status: true } },
      },
    });
    const blocked =
      isBlockedStatus(shop?.status) ||
      isBlockedStatus(shop?.primaryShop?.status);
    cache.set(shopId, { blocked, expiresAt: now + TTL_MS });
    return blocked;
  } catch (error) {
    logger.warn(`Impossible de vérifier le statut de la boutique ${shopId}`);
    return false;
  }
};
