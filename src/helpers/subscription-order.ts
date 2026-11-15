import type { Prisma } from "../database/prisma/generated/prisma/client.js";

/**
 * Règle métier : l'abonnement "courant" d'une boutique est le plus récent
 * (createdAt desc, puis id desc pour départager deux lignes créées au même instant).
 * À utiliser partout où l'on lit ou modifie l'abonnement courant d'une boutique.
 */
export const LATEST_SUBSCRIPTION_ORDER: Prisma.SubscriptionOrderByWithRelationInput[] =
  [{ createdAt: "desc" }, { id: "desc" }];
