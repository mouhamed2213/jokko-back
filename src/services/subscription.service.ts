import { prisma } from "../config/prisma.js";
import { Prisma } from "../database/prisma/generated/prisma/client.js";
import { dateManagement } from "../helpers/dates.js";
import { NotFoundError } from "../utils/errors.js";

type SubscriptionWithPlan = Prisma.SubscriptionGetPayload<{
  include: {
    plan: {
      include: {
        planFeature: {
          include: {
            feature: true;
          };
        };
      };
    };
  };
}>;

export const SubscriptionService = {

  currentSubscription: async (shopId: number , shopOwnerId: number) => {
    let subscription: SubscriptionWithPlan | null =
      await prisma.subscription.findFirst({
        where: {
          shopOwnerId : shopOwnerId
        },
        include: {
          plan: {
            include: {
              planFeature: {
                include: {
                  feature: true,
                },
              },
            },
          },
        },
      });

    if (!subscription) {
      throw new NotFoundError("No active subscription");
    }

    subscription =
      await SubscriptionService.ensureSubscriptionIsValid(subscription, shopOwnerId);

    return {
      id: subscription.id,
      status: subscription.status,
      endDate: subscription?.endDate,

      plan: {
        code: subscription.plan.code,
        name: subscription.plan.name,
      },

      limits: {
        sales: subscription.plan.maxSalesPerMonth,
        products: subscription.plan.maxProducts,
        customers: subscription.plan.maxCustomers,
        users: subscription.plan.maxUsers,
        stores: subscription.plan.maxStores,
         suppliers: subscription.plan.maxSuppliers,
      },

      features: subscription.plan.planFeature.map((pf) => pf.feature.code),
    };
  },

  ensureSubscriptionIsValid: async (
    subscription: SubscriptionWithPlan,
    shopOwnerId :number
  ): Promise<SubscriptionWithPlan> => {

    if (subscription.plan.code === "FREE") {
      return subscription;
    }

    if (!subscription.endDate) {
      return subscription;
    }

    // const now = new Date("2026-09-07T18:44:35.348Z");
    const now = new Date();
    // Trial still active
    if (subscription.endDate > now) {

      return subscription;
    }

    // Downgrade if endDate
    return SubscriptionService.downgradeToFree(subscription , shopOwnerId);
  },

  downgradeToFree: async (
    subscription: SubscriptionWithPlan,
    shopOwnerId : number
  ): Promise<SubscriptionWithPlan> => {


    const freePlan = await prisma.plan.findUnique({
      where: {
        code: "FREE",
      },
    });

    if (!freePlan) {
      throw new NotFoundError("Free plan not found");
    }


    const subcriptionStatus = subscription.status
    // end subscripton status condtion
    const status = subcriptionStatus==="TRIAL" ? "TRIAL_EXPIRED" :  subcriptionStatus==="ACTIVE" ? "EXPIRED" : "EXPIRED" 

    return prisma.subscription.update({
      where: {
        id: subscription.id,
        shopOwnerId,
        // status : "EXPIRED"

      },
      data: {
        planId: freePlan.id,
        status ,
        endDate: null,
      },
      include: {
        shop : true,
        shopOwner : true,
        plan: {
          include: {
            planFeature: {
              include: {
                feature: true,
              },
            },
          },
        },
      },
    });
  },


  renewal: async (
    subscriptionId: number,
    shopOwnerId: number,
    selectedPlanId: number,
  ) => {


    const dateFn = dateManagement();
    const update = await prisma.subscription.update({
      where: { id: subscriptionId,  shopOwnerId  },
      data: {
        planId: selectedPlanId,
        status: "ACTIVE",
        startDate: dateFn.startDate,
        endDate: dateFn.endSubscriptionSate,
      },
      include: {
        
        plan: {
          include: {
            planFeature: {
              include: {
                feature: true,
              },
            },
          },
        },
      },
    });

    return update;
  },
};
