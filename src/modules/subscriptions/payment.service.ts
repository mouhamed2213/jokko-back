import { prisma } from "../../config/prisma.js";
import { PaymentStatus } from "../../database/prisma/generated/prisma/enums.js";
import { CreatePaymentOptions } from "../../types/index.js";

import { NotFoundError } from "../../utils/errors.js";

export const PaymentService = {
  createPayment: async (paymentOptions: CreatePaymentOptions) => {
    try {
      const payment = await prisma.payment.create({
        data: paymentOptions,
      });

      return payment;
    } catch (e) {
      console.error("Error while creating payment : ", e);
      throw e;
    }
  },

  findPayment: async (paymentId: number) => {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundError("Payment not found");
    }

    return payment;
  },

  updatePayment: async (paymentId: number, newSatus: PaymentStatus) => {
    try {
      const update = await prisma.payment.update({
        where: { id: paymentId },
        data: { status: newSatus },
        // transaction_id
      });

      return { update: update.status, updateDate: update.updatedAt };
    } catch (e) {
      // should use logger later
      console.error("Update Status failed !!");

      throw e;
    }
  },

  //
};

