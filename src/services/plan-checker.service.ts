import {
  FeatureCode,
  PlanType,
} from "../database/prisma/generated/prisma/enums.js";
import { NotFoundError } from "../utils/errors.js";
import { SubscriptionService } from "./subscription.service.js";

export type SubscriptionDTO = {
  id: number;
  status: "ACTIVE" | "EXPIRED" | "SUSPENDED" | "TRIAL" | "TRIAL_EXPIRED";
  plan: {
    code: PlanType;
    name: string;
  };

  limits: {
    sales: number | null;
    products: number | null;
    customers: number | null;
    users: number | null;
    stores: number | null;
    suppliers: number | null;
  };

  features: FeatureCode[];
};

export const PlanChecker = {
  /**
   * Vérifie si une boutique a le droit de créer une ressource selon son plan
   */
  plan: async (shopId: number , shopOwnerId: number): Promise<SubscriptionDTO> => {
    const shop = await SubscriptionService.currentSubscription(shopId, shopOwnerId);
    if (!shop) throw new NotFoundError("Shop not found");
    return shop;
  },

  //  What are the limits
  //  What are the features
};
