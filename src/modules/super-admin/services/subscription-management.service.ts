import { prisma } from "../../../config/prisma.js";
import { PaymentMethod, PaymentStatus, SubscriptionStatus } from "../../../database/prisma/generated/prisma/enums.js";
import { dateManagement } from "../../../helpers/dates.js";
import { LATEST_SUBSCRIPTION_ORDER } from "../../../helpers/subscription-order.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../../utils/errors.js";

const paymentMethods = ["WAVE", "ORANGE_MONEY", "OTHER"] as const;

type ManualPaymentInput = {
  shopId: number;
  planCode: string;
  provider: (typeof paymentMethods)[number];
  amount?: number;
  transactionReference?: string;
};

export const SubscriptionManagementService = {
  /**
   * A paid plan change first creates a PENDING payment.
   * The current subscription is intentionally left unchanged until verification.
   */
  changePlan: async ({ shopId, planCode, provider, amount, transactionReference }: ManualPaymentInput) => {
    if (!Number.isSafeInteger(shopId) || shopId <= 0) {
      throw new BadRequestError("Identifiant de boutique invalide");
    }

    const normalizedPlanCode = String(planCode || "").trim().toUpperCase();
    const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } });
    if (!shop) throw new NotFoundError("Boutique introuvable");

    const currentSub = await prisma.subscription.findFirst({
      where: { shopId },
      orderBy: LATEST_SUBSCRIPTION_ORDER,
      include: { plan: true },
    });
    if (!currentSub) throw new NotFoundError("Abonnement introuvable");

    // Subscription.shopOwnerId references ShopOwner.id, never User.id.
    const shopOwner = await prisma.shopOwner.findUnique({
      where: { id: currentSub.shopOwnerId },
      select: { id: true, shopId: true },
    });
    if (!shopOwner || shopOwner.shopId !== shopId) {
      throw new NotFoundError("Propriétaire associé à l'abonnement introuvable");
    }

    const newPlan = await prisma.plan.findUnique({ where: { code: normalizedPlanCode as any } });
    if (!newPlan) throw new NotFoundError(`Plan ${normalizedPlanCode} introuvable`);
    if (newPlan.code === currentSub.plan.code) {
      throw new BadRequestError("Cette boutique utilise déjà ce forfait");
    }

    if (newPlan.code === "FREE") {
      const freeSub = await prisma.$transaction(async (tx) => {
        const freePlan = await tx.plan.findUnique({ where: { code: "FREE" } });
        if (!freePlan) throw new NotFoundError("Plan gratuit introuvable");
        return tx.subscription.update({
          where: { id: currentSub.id, shopOwnerId: shopOwner.id },
          data: {
            planId: freePlan.id,
            status: currentSub.status === "TRIAL" ? "TRIAL_EXPIRED" : "EXPIRED",
            startDate: new Date(),
            endDate: null,
          },
          include: { plan: { include: { planFeature: { include: { feature: true } } } } },
        });
      });
      return { subscription: freeSub, payment: null, requiresPayment: false };
    }

    if (!paymentMethods.includes(provider)) {
      throw new BadRequestError("Moyen de paiement invalide");
    }
    const paymentAmount = amount === undefined ? newPlan.price : Number(amount);
    if (!Number.isSafeInteger(paymentAmount) || paymentAmount <= 0) {
      throw new BadRequestError("Le montant doit être un entier positif en FCFA");
    }

    const reference = transactionReference?.trim() || undefined;
    if (reference && reference.length > 120) {
      throw new BadRequestError("La référence de transaction est trop longue");
    }

    const payment = await prisma.$transaction(async (tx) => {
      const existingPending = await tx.payment.findFirst({
        where: { subscriptionId: currentSub.id, status: "PENDING", paymentType: "SUBSCRIPTION" },
        select: { id: true },
      });
      if (existingPending) {
        throw new BadRequestError("Un paiement est déjà en attente pour cette boutique. Vérifiez-le ou annulez-le avant d'en créer un autre.");
      }

      return tx.payment.create({
        data: {
          shopOwnerId: shopOwner.id,
          subscriptionId: currentSub.id,
          planId: newPlan.id,
          planCode: newPlan.code,
          planName: newPlan.name,
          provider: provider as PaymentMethod,
          amount: paymentAmount,
          status: PaymentStatus.PENDING,
          paymentType: "SUBSCRIPTION",
          transactionReference: reference,
        },
      });
    });

    return { subscription: currentSub, payment, requiresPayment: true };
  },

  /**
   * Confirmation is the only operation that activates the purchased plan.
   * Payment and subscription updates, plus the audit entry, commit atomically.
   */
  confirmPayment: async (paymentId: number, actor: { actorId: number; actorName: string }) => {
    if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
      throw new BadRequestError("Identifiant de paiement invalide");
    }

    return prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: { subscription: true, plan: true, shopOwner: { include: { shop: true } } },
      });
      if (!payment) throw new NotFoundError("Paiement introuvable");
      if (payment.status !== "PENDING") {
        throw new BadRequestError("Ce paiement n'est plus en attente");
      }
      if (payment.paymentType !== "SUBSCRIPTION") {
        throw new BadRequestError("Ce paiement ne concerne pas un abonnement");
      }
      if (payment.subscription.shopId !== payment.shopOwner.shopId) {
        throw new ForbiddenError("Le paiement ne correspond pas à la boutique de l'abonnement");
      }

      // Conditional transition prevents two concurrent admins from activating the same payment twice.
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.SUCCESS, paidAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new BadRequestError("Ce paiement vient d'être traité par un autre administrateur");
      }

      const now = new Date();
      const dates = dateManagement();
      const subscription = await tx.subscription.update({
        where: { id: payment.subscriptionId, shopOwnerId: payment.shopOwnerId },
        data: {
          planId: payment.planId,
          status: SubscriptionStatus.ACTIVE,
          startDate: dates.startDate,
          endDate: dates.endSubscriptionSate,
        },
        include: { plan: { include: { planFeature: { include: { feature: true } } } } },
      });

      const confirmedPayment = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });

      await tx.auditLog.create({
        data: {
          actorId: actor.actorId,
          actorName: actor.actorName,
          action: "CONFIRM_SUBSCRIPTION_PAYMENT",
          targetType: "Subscription",
          targetId: payment.subscription.shopId,
          details: {
            shopId: payment.shopOwner.shopId,
            subscriptionId: payment.subscriptionId,
            planCode: payment.planCode,
            amount: payment.amount,
            provider: payment.provider,
            transactionReference: payment.transactionReference,
          },
        },
      });

      return { subscription, payment: confirmedPayment };
    });
  },

  cancelPendingPayment: async (paymentId: number, actor: { actorId: number; actorName: string }) => {
    if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
      throw new BadRequestError("Identifiant de paiement invalide");
    }

    return prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: { subscription: true },
      });
      if (!payment) throw new NotFoundError("Paiement introuvable");
      if (payment.paymentType !== "SUBSCRIPTION" || payment.status !== "PENDING") {
        throw new BadRequestError("Seul un paiement d'abonnement en attente peut être annulé");
      }

      const cancelled = await tx.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.CANCELLED },
      });
      if (cancelled.count !== 1) {
        throw new BadRequestError("Ce paiement vient d'être traité par un autre administrateur");
      }

      await tx.auditLog.create({
        data: {
          actorId: actor.actorId,
          actorName: actor.actorName,
          action: "CANCEL_SUBSCRIPTION_PAYMENT",
          targetType: "Subscription",
          targetId: payment.subscription.shopId,
          details: { paymentId: payment.id, planCode: payment.planCode, amount: payment.amount },
        },
      });

      return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    });
  },

  updateStatus: async (shopId: number, status: SubscriptionStatus) => {
    const validStatuses = ["TRIAL", "ACTIVE", "EXPIRED", "TRIAL_EXPIRED", "SUSPENDED"];
    if (!validStatuses.includes(status)) throw new ForbiddenError(`Statut invalide: ${status}`);

    const subscription = await prisma.subscription.findFirst({
      where: { shopId },
      orderBy: LATEST_SUBSCRIPTION_ORDER,
    });
    if (!subscription) throw new NotFoundError("Abonnement introuvable");

    return prisma.subscription.update({
      where: { id: subscription.id },
      data: { status },
      include: { plan: true, shop: true },
    });
  },

  extendPeriod: async (shopId: number, daysToAdd: number) => {
    if (daysToAdd <= 0) throw new ForbiddenError("Nombre de jours doit être > 0");

    const subscription = await prisma.subscription.findFirst({
      where: { shopId },
      orderBy: LATEST_SUBSCRIPTION_ORDER,
    });
    if (!subscription) throw new NotFoundError("Abonnement introuvable");
    if (!subscription.endDate) {
      throw new ForbiddenError("Impossible de prolonger: cet abonnement n'a pas de date d'expiration (plan FREE)");
    }

    const newEndDate = new Date(subscription.endDate);
    newEndDate.setDate(newEndDate.getDate() + daysToAdd);

    return prisma.subscription.update({
      where: { id: subscription.id },
      data: { endDate: newEndDate },
      include: { plan: true, shop: true },
    });
  },
};
