import { prisma } from "../../../config/prisma.js";
import { SubscriptionStatus } from "../../../database/prisma/generated/prisma/enums.js";
import { PaymentService } from "../../../services/payment.service.js";
import { SubscriptionService } from "../../../services/subscription.service.js";
import { ForbiddenError, NotFoundError } from "../../../utils/errors.js";

export const SubscriptionManagementService = {
  /**
   * Change a shop's subscription plan
   * Creates a Payment record and updates subscription via renewal
   */
  changePlan: async (
    shopId: number,
    planCode: string,
    paymentReference?: string,
  ) => {
    // Find shop and verify it exists
    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new NotFoundError("Boutique introuvable");

    // Find shop owner (latest one)
    const shopOwner = await prisma.shopOwner.findFirst({
      where: { shopId },
    });
    if (!shopOwner)
      throw new NotFoundError("Propriétaire boutique introuvable");

    // Get current subscription
    const currentSub = await prisma.subscription.findFirst({
      where: { shopId },
      orderBy: { createdAt: "desc" },
      include: { plan: true },
    });
    if (!currentSub) throw new NotFoundError("Abonnement introuvable");

    // Get new plan
    const newPlan = await prisma.plan.findUnique({
      where: { code: planCode as any },
    });
    if (!newPlan) throw new NotFoundError(`Plan ${planCode} introuvable`);

    // If new plan is FREE, special handling (end trial, no payment)
    if (newPlan.code === "FREE") {
      const freeSub = await SubscriptionService.downgradeToFree(
        currentSub as any,
        shopOwner.userId,
      );
      return { subscription: freeSub, payment: null };
    }

    // Create Payment record (status SUCCESS, manual payment)
    const payment = await PaymentService.createPayment({
      shopOwnerId: shopOwner.id,
      subscriptionId: currentSub.id,
      planId: newPlan.id,
      planCode: newPlan.code,
      planName: newPlan.name,
      provider: "IN_APP" as any,
      amount: newPlan.price,
    });

    // Mark payment as SUCCESS (manual payment handled outside)
    await PaymentService.updatePayment(payment.id, "SUCCESS");

    // Update subscription via renewal service
    const updatedSub = await SubscriptionService.renewal(
      currentSub.id,
      shopOwner.userId,
      newPlan.id,
    );

    return {
      subscription: updatedSub,
      payment: await prisma.payment.findUnique({ where: { id: payment.id } }),
    };
  },

  /**
   * Update subscription status manually
   */
  updateStatus: async (shopId: number, status: SubscriptionStatus) => {
    const validStatuses = [
      "TRIAL",
      "ACTIVE",
      "EXPIRED",
      "TRIAL_EXPIRED",
      "SUSPENDED",
    ];
    if (!validStatuses.includes(status)) {
      throw new ForbiddenError(`Statut invalide: ${status}`);
    }

    const subscription = await prisma.subscription.findFirst({
      where: { shopId },
      orderBy: { createdAt: "desc" },
    });
    if (!subscription) throw new NotFoundError("Abonnement introuvable");

    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: status as any },
      include: { plan: true, shop: true },
    });

    return updated;
  },

  /**
   * Extend the trial/subscription period by adding days to endDate
   */
  extendPeriod: async (shopId: number, daysToAdd: number) => {
    if (daysToAdd <= 0) {
      throw new ForbiddenError("Nombre de jours doit être > 0");
    }

    const subscription = await prisma.subscription.findFirst({
      where: { shopId },
      orderBy: { createdAt: "desc" },
    });
    if (!subscription) throw new NotFoundError("Abonnement introuvable");

    if (!subscription.endDate) {
      throw new ForbiddenError(
        "Impossible de prolonger: cette abonnement n'a pas de date d'expiration (plan FREE)",
      );
    }

    const newEndDate = new Date(subscription.endDate);
    newEndDate.setDate(newEndDate.getDate() + daysToAdd);

    const update = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { endDate: newEndDate },
      include: { plan: true, shop: true },
    });

    return update;
  },
};
