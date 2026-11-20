import { logger } from "../../config/logger.js";
import { prisma } from "../../config/prisma.js";
import { BadRequestError, NotFoundError } from "../../utils/errors.js";

const METHOD_LABELS: Record<string, string> = {
  CASH: "💵 Espèces",
  WAVE: "🔵 Wave",
  ORANGE_MONEY: "🟠 Orange Money",
  FREE_MONEY: "🟣 Free Money",
  BANK: "🏦 Virement bancaire",
  OTHER: "📱 Autre",
};

const VALID_METHODS = [
  "CASH",
  "WAVE",
  "ORANGE_MONEY",
  "FREE_MONEY",
  "BANK",
  "OTHER",
];

export const CashService = {
  open: async (
    shopId: number,
    userId: number,
    openingAmount: number | string | undefined | null,
    note?: string,
  ) => {
    if (openingAmount === undefined || openingAmount === null) {
      throw new BadRequestError("Le montant d'ouverture est obligatoire");
    }

    const existing = await prisma.cashRegister.findFirst({
      where: { shopId, status: "OPEN" },
    });
    if (existing) {
      return { alreadyOpen: true as const, cashRegister: existing };
    }

    const cashRegister = await prisma.cashRegister.create({
      data: {
        shopId,
        userId,
        openingAmount: Number(openingAmount),
        note: note || null,
      },
    });

    logger.info(
      `🟢 Caisse ouverte — Shop: ${shopId} — Montant: ${openingAmount} FCFA — User: ${userId}`,
    );
    return { alreadyOpen: false as const, cashRegister };
  },

  close: async (shopId: number, id: number, note?: string) => {
    const cashRegister = await prisma.cashRegister.findFirst({
      where: { id, shopId, status: "OPEN" },
      include: { transactions: true },
    });
    if (!cashRegister) {
      throw new NotFoundError("Caisse ouverte introuvable");
    }

    const closingAmount =
      cashRegister.openingAmount + cashRegister.totalIn - cashRegister.totalOut;

    const closed = await prisma.cashRegister.update({
      where: { id },
      data: {
        status: "CLOSED",
        closingAmount,
        closedAt: new Date(),
        note: note || cashRegister.note,
      },
      include: {
        transactions: true,
        user: { select: { name: true } },
      },
    });

    const byMethod: Record<string, { in: number; out: number }> = {};
    for (const tx of closed.transactions) {
      const m = tx.paymentMethod || "CASH";
      if (!byMethod[m]) byMethod[m] = { in: 0, out: 0 };
      if (tx.type === "IN") byMethod[m].in += tx.amount;
      else byMethod[m].out += tx.amount;
    }

    const paymentMethodSummary = Object.entries(byMethod).map(
      ([method, amounts]) => ({
        method,
        label: METHOD_LABELS[method] || method,
        totalIn: amounts.in,
        totalOut: amounts.out,
        net: amounts.in - amounts.out,
      }),
    );

    const summary = {
      date: new Date().toLocaleDateString("fr-FR"),
      openedAt: cashRegister.openedAt,
      closedAt: closed.closedAt,
      openingAmount: cashRegister.openingAmount,
      totalIn: cashRegister.totalIn,
      totalOut: cashRegister.totalOut,
      closingAmount,
      transactionCount: cashRegister.transactions.length,
      openedBy: closed.user?.name || "Inconnu",
      paymentMethodSummary,
    };

    logger.info(
      `🔴 Caisse fermée — Shop: ${shopId} — Clôture: ${closingAmount} FCFA — Entrées: ${cashRegister.totalIn} FCFA — Sorties: ${cashRegister.totalOut} FCFA`,
    );

    return { cashRegister: closed, summary };
  },

  getCurrent: async (shopId: number) => {
    const cashRegister = await prisma.cashRegister.findFirst({
      where: { shopId, status: "OPEN" },
      include: {
        transactions: { orderBy: { createdAt: "desc" } },
        user: { select: { name: true } },
      },
    });

    if (!cashRegister) {
      return { open: false, cashRegister: null };
    }

    const currentBalance =
      cashRegister.openingAmount + cashRegister.totalIn - cashRegister.totalOut;

    return {
      open: true,
      cashRegister: { ...cashRegister, currentBalance },
    };
  },

  getHistory: async (shopId: number, page = 1, limit = 15) => {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const skip = (safePage - 1) * safeLimit;

    const [total, registers] = await Promise.all([
      prisma.cashRegister.count({ where: { shopId } }),
      prisma.cashRegister.findMany({
        where: { shopId },
        include: {
          user: { select: { name: true } },
          transactions: { orderBy: { createdAt: "asc" } },
        },
        orderBy: { openedAt: "desc" },
        skip,
        take: safeLimit,
      }),
    ]);

    const data = registers.map((r) => ({
      ...r,
      currentBalance:
        r.closingAmount ?? r.openingAmount + r.totalIn - r.totalOut,
      transactionCount: r.transactions.length,
      salesIncome: r.transactions
        .filter((t) => t.type === "IN" && t.label.startsWith("Vente"))
        .reduce((sum, t) => sum + t.amount, 0),
      supplierPayments: r.transactions
        .filter(
          (t) =>
            t.type === "OUT" && t.label.toLowerCase().includes("fournisseur"),
        )
        .reduce((sum, t) => sum + t.amount, 0),
    }));

    return {
      data,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  },

  getById: async (shopId: number, id: number) => {
    const cashRegister = await prisma.cashRegister.findFirst({
      where: { id, shopId },
      include: {
        transactions: { orderBy: { createdAt: "asc" } },
        user: { select: { name: true } },
      },
    });

    if (!cashRegister) {
      throw new NotFoundError("Session de caisse introuvable");
    }

    const balance =
      cashRegister.closingAmount ??
      cashRegister.openingAmount + cashRegister.totalIn - cashRegister.totalOut;

    return { ...cashRegister, currentBalance: balance };
  },

  addTransaction: async (
    shopId: number,
    payload: {
      type?: string;
      amount?: number | string;
      label?: string;
      reference?: string;
      paymentMethod?: string;
    },
  ) => {
    const { type, amount, label, reference, paymentMethod } = payload;

    if (!type || !amount || !label) {
      throw new BadRequestError(
        "Type, montant et libellé sont obligatoires",
      );
    }
    if (!["IN", "OUT"].includes(type)) {
      throw new BadRequestError("Type doit être IN ou OUT");
    }

    const method =
      paymentMethod && VALID_METHODS.includes(paymentMethod)
        ? paymentMethod
        : "CASH";

    const cashRegister = await prisma.cashRegister.findFirst({
      where: { shopId, status: "OPEN" },
    });
    if (!cashRegister) {
      throw new BadRequestError(
        "Aucune caisse ouverte. Ouvrez la caisse avant toute transaction.",
      );
    }

    const amountNum = Number(amount);

    const [transaction] = await prisma.$transaction([
      prisma.cashTransaction.create({
        data: {
          cashRegisterId: cashRegister.id,
          type,
          amount: amountNum,
          label,
          reference: reference || null,
          paymentMethod: method,
        },
      }),
      prisma.cashRegister.update({
        where: { id: cashRegister.id },
        data:
          type === "IN"
            ? { totalIn: { increment: amountNum } }
            : { totalOut: { increment: amountNum } },
      }),
    ]);

    logger.info(
      `💳 Transaction manuelle — ${type} — ${amountNum} FCFA — "${label}" — Shop: ${shopId}`,
    );
    return transaction;
  },
};
