import type { Prisma } from "../../database/prisma/generated/prisma/client.js";
import { PackagingUnit } from "../../database/prisma/generated/prisma/enums.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../config/prisma.js";
import { sendNotificationToShop } from "../notifications/notification.service.js";
import {
  computePriceForUnit,
  getUnitLabel,
  parsePackagingUnit,
} from "../../helpers/packaging.js";
import {
  isValidPaymentMethod,
  normalizePaymentSplits,
  type PaymentSplitInput,
} from "../../helpers/payment-splits.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../utils/errors.js";
import { PlanChecker } from "../subscriptions/plan-checker.service.js";

export function getSaleStatus(paid: number, total: number) {
  if (paid >= total) return "PAID";
  if (paid > 0) return "PARTIAL";
  return "UNPAID";
}

export type Item = {
  productId: number;
  quantity: number;
  unitPrice: number;
  soldUnit?: PackagingUnit;
};

async function generateInvoiceNumberInTx(
  tx: Prisma.TransactionClient,
  shopId: number,
  offset = 0,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `FAC-${year}-`;

  const lastSale = await tx.sale.findFirst({
    where: {
      shopId,
      invoiceNumber: { startsWith: prefix },
    },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });

  let nextSeq = 1;
  if (lastSale?.invoiceNumber) {
    const suffix = lastSale.invoiceNumber.slice(prefix.length);
    const parsed = Number.parseInt(suffix, 10);
    if (Number.isFinite(parsed) && parsed > 0 && suffix.length <= 8) {
      nextSeq = parsed + 1;
    } else {
      const countThisYear = await tx.sale.count({
        where: { shopId, invoiceNumber: { startsWith: prefix } },
      });
      nextSeq = countThisYear + 1;
    }
  }

  return `${prefix}${String(nextSeq + offset).padStart(5, "0")}`;
}

export async function getMixedPaymentSaleIds(shopId: number): Promise<number[]> {
  const rows = await prisma.salePayment.findMany({
    where: { sale: { shopId } },
    select: { saleId: true, paymentMethod: true },
  });
  const methodsBySale = new Map<number, Set<string>>();
  for (const row of rows) {
    let set = methodsBySale.get(row.saleId);
    if (!set) {
      set = new Set();
      methodsBySale.set(row.saleId, set);
    }
    set.add(row.paymentMethod || "CASH");
  }
  const mixedIds: number[] = [];
  for (const [saleId, methods] of methodsBySale.entries()) {
    if (methods.size > 1) mixedIds.push(saleId);
  }
  return mixedIds;
}

export const SaleService = {
  list: async (
    shopId: number,
    query: {
      status?: string;
      clientId?: number;
      search?: string;
      paymentMethod?: string;
      page?: number;
      limit?: number;
    },
  ) => {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(50, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.SaleWhereInput = { shopId };
    if (
      query.status &&
      ["PAID", "PARTIAL", "UNPAID", "CANCELLED"].includes(query.status)
    ) {
      where.status = query.status;
    }
    if (query.clientId) where.clientId = query.clientId;
    if (query.paymentMethod) {
      const pm = query.paymentMethod.trim().toUpperCase();
      if (pm === "MIXED") {
        const mixedIds = await getMixedPaymentSaleIds(shopId);
        where.id = { in: mixedIds };
      } else if (isValidPaymentMethod(pm)) {
        where.payments = { some: { paymentMethod: pm } };
      }
    }
    if (query.search) {
      where.OR = [
        { invoiceNumber: { contains: query.search, mode: "insensitive" } },
        { customerName: { contains: query.search, mode: "insensitive" } },
        { client: { name: { contains: query.search, mode: "insensitive" } } },
        { client: { phone: { contains: query.search, mode: "insensitive" } } },
        {
          items: {
            some: {
              productName: { contains: query.search, mode: "insensitive" },
            },
          },
        },
      ];
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total, sales, salescount] = await Promise.all([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        include: {
          client: true,
          items: { include: { product: true } },
          payments: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.sale.count({
        where: {
          shopId,
          status: { not: "CANCELLED" },
          createdAt: { gte: startOfMonth },
        },
      }),
    ]);

    return {
      data: sales,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      meta: { salescount },
    };
  },

  getById: async (shopId: number, id: number) => {
    const sale = await prisma.sale.findFirst({
      where: { id, shopId },
      include: {
        client: true,
        items: { include: { product: true } },
        payments: true,
      },
    });
    if (!sale) {
      throw new NotFoundError("Vente introuvable");
    }
    return sale;
  },

  /**
   * Modifie une vente existante (articles, quantités, client...).
   * Interdit si la vente est annulée ou a déjà reçu un paiement.
   */
  updateSale: async (
    shopId: number,
    userId: number,
    saleId: number,
    clientId: number | null | undefined,
    customerName: string | undefined,
    items: Item[],
    note: string | undefined,
  ) => {
    const existingSale = await prisma.sale.findFirst({
      where: { id: saleId, shopId },
      include: { items: true },
    });
    if (!existingSale) {
      throw new NotFoundError("Facture introuvable");
    }

    if (existingSale.status === "CANCELLED") {
      throw new ForbiddenError("Impossible de modifier une facture annulée.");
    }

    if (existingSale.paidAmount > 0) {
      throw new ForbiddenError(
        "Impossible de modifier une facture ayant déjà reçu un paiement. Annulez-la puis recréez-la si besoin.",
      );
    }

    if (!items || items.length === 0) {
      throw new BadRequestError("Au moins un article est requis");
    }

    if (!clientId) {
      throw new BadRequestError(
        "Une fiche client est obligatoire pour une facture impayée.",
      );
    }

    const client = await prisma.client.findFirst({
      where: { id: Number(clientId), shopId },
      select: { id: true },
    });
    if (!client) {
      throw new NotFoundError("Client introuvable");
    }

    const normalizedItems = items.map((item) => {
      const pid = Number(item.productId);
      const qty = Number(item.quantity);
      const price = Number(item.unitPrice);
      const soldUnit: PackagingUnit = item.soldUnit
        ? parsePackagingUnit(item.soldUnit)
        : "PIECE";
      if (!Number.isInteger(pid) || pid <= 0) {
        throw new BadRequestError("Identifiant de produit invalide.");
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new BadRequestError("La quantité de chaque article doit être un entier positif.");
      }
      if (!Number.isFinite(price) || price <= 0) {
        throw new BadRequestError("Le prix unitaire de chaque article doit être positif.");
      }
      return { pid, qty, soldUnit, soldUnitPrice: price };
    });

    const newProductIds = [...new Set(normalizedItems.map((i) => i.pid))];
    const products = await prisma.product.findMany({
      where: { id: { in: newProductIds }, shopId, isActive: true },
    });

    for (const pid of newProductIds) {
      if (!products.find((p) => p.id === pid)) {
        throw new NotFoundError(`Produit ID ${pid} introuvable`);
      }
    }

    const previouslySold = new Map<number, number>();
    for (const oldItem of existingSale.items) {
      if (!oldItem.productId) continue;
      previouslySold.set(
        oldItem.productId,
        (previouslySold.get(oldItem.productId) || 0) + oldItem.quantity,
      );
    }

    const newlyRequested = new Map<number, number>();
    const resolvedItems = normalizedItems.map((item) => {
      const product = products.find((p) => p.id === item.pid)!;
      if (item.soldUnit !== "PIECE" && item.soldUnit !== product.unitType) {
        throw new BadRequestError(
          `Le produit "${product.name}" ne peut pas être vendu en ${getUnitLabel(item.soldUnit)}.`,
        );
      }
      const multiplier =
        item.soldUnit === "PIECE" ? 1 : Math.max(1, product.unitsPerPack);
      const piecesCount = item.qty * multiplier;
      const lineTotal = item.soldUnitPrice * item.qty;
      const effectivePiecePrice = lineTotal / piecesCount;

      newlyRequested.set(
        item.pid,
        (newlyRequested.get(item.pid) || 0) + piecesCount,
      );

      return {
        product,
        soldUnit: item.soldUnit,
        soldQuantity: item.qty,
        soldUnitPrice: item.soldUnitPrice,
        piecesCount,
        effectivePiecePrice,
        lineTotal,
      };
    });

    const totalAmount = resolvedItems.reduce(
      (sum, item) => sum + item.lineTotal,
      0,
    );

    const updatedSale = await prisma.$transaction(async (tx) => {
      const touchedProductIds = new Set<number>([
        ...previouslySold.keys(),
        ...newlyRequested.keys(),
      ]);

      for (const productId of touchedProductIds) {
        const oldQty = previouslySold.get(productId) || 0;
        const newQty = newlyRequested.get(productId) || 0;
        const delta = newQty - oldQty;
        if (delta === 0) continue;

        if (delta > 0) {
          const updated = await tx.product.updateMany({
            where: {
              id: productId,
              shopId,
              quantity: { gte: delta },
            },
            data: { quantity: { decrement: delta } },
          });
          if (updated.count === 0) {
            const p = products.find((prod) => prod.id === productId);
            throw new BadRequestError(
              `Stock insuffisant pour "${p?.name || `Produit #${productId}`}"`,
            );
          }
          await tx.stockMovement.create({
            data: {
              shopId,
              productId,
              userId,
              type: "SALE",
              quantity: delta,
              note: `Modification facture ${existingSale.invoiceNumber || `#${saleId}`} (+${delta})`,
            },
          });
        } else {
          const restored = Math.abs(delta);
          await tx.product.update({
            where: { id: productId },
            data: { quantity: { increment: restored } },
          });
          await tx.stockMovement.create({
            data: {
              shopId,
              productId,
              userId,
              type: "ENTRY",
              quantity: restored,
              note: `Modification facture ${existingSale.invoiceNumber || `#${saleId}`} (-${restored})`,
            },
          });
        }
      }

      await tx.saleItem.deleteMany({ where: { saleId } });

      return tx.sale.update({
        where: { id: saleId },
        data: {
          clientId: Number(clientId),
          customerName: customerName?.trim() || null,
          totalAmount,
          remaining: totalAmount,
          status: getSaleStatus(0, totalAmount),
          note: note !== undefined ? note || null : existingSale.note,
          items: {
            create: resolvedItems.map((item) => ({
              productId: item.product.id,
              productName: item.product.name,
              productImageUrl: item.product.imageUrl,
              quantity: item.piecesCount,
              unitPrice: item.effectivePiecePrice,
              soldUnit: item.soldUnit,
              soldQuantity: item.soldQuantity,
              soldUnitPrice: item.soldUnitPrice,
              totalAmount: item.lineTotal,
            })),
          },
        },
        include: {
          client: true,
          items: { include: { product: true } },
          payments: { orderBy: { paidAt: "asc" } },
        },
      });
    });

    logger.info(
      `✏️ Facture modifiée — ${existingSale.invoiceNumber || `#${saleId}`} — Nouveau total: ${totalAmount} FCFA — Shop: ${shopId}`,
    );

    return updatedSale;
  },

  createSale: async (
    shopOwnerId: number,
    shopId: number,
    userId: number,
    userRole: string,
    clientId: number | null | undefined,
    customerName: string | undefined,
    paidAmount: number | string | undefined,
    paymentMethod: string | undefined,
    items: Item[],
    note: string | undefined,
    payments?: PaymentSplitInput[],
  ) => {
    const subscription = await PlanChecker.plan(shopId, shopOwnerId);
    if (!subscription) {
      throw new ForbiddenError("Abonnement introuvable");
    }

    const maxSalesPerMonth = subscription.limits.sales;
    if (maxSalesPerMonth !== null && maxSalesPerMonth !== undefined) {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const currentSales = await prisma.sale.count({
        where: {
          shopId,
          status: { not: "CANCELLED" },
          createdAt: { gte: startOfMonth },
        },
      });

      if (currentSales >= maxSalesPerMonth) {
        throw new ForbiddenError(
          `Vous avez atteint la limite mensuelle de ${maxSalesPerMonth} ventes autorisées par votre abonnement.`,
        );
      }
    }

    // 1. Validation stricte des articles
    const normalizedInputs = items.map((item) => {
      const pid = Number(item.productId);
      const qty = Number(item.quantity);
      const soldUnit = item.soldUnit ? parsePackagingUnit(item.soldUnit) : undefined;
      if (!Number.isInteger(pid) || pid <= 0) {
        throw new BadRequestError("Identifiant de produit invalide.");
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new BadRequestError("La quantité de chaque article doit être un entier positif.");
      }
      if (userRole === "ADMIN") {
        const price = Number(item.unitPrice);
        if (!Number.isFinite(price) || price <= 0) {
          throw new BadRequestError("Le prix unitaire de chaque article doit être supérieur à 0.");
        }
      }
      return { pid, qty, soldUnit, rawUnitPrice: Number(item.unitPrice) };
    });

    const uniqueProductIds = [...new Set(normalizedInputs.map((i) => i.pid))];
    const products = await prisma.product.findMany({
      where: { id: { in: uniqueProductIds }, shopId, isActive: true },
    });

    // Quantité agrégée par (produit, unité vendue) pour le calcul des paliers
    const qtyByProductAndUnit = new Map<string, number>();
    const requestedPiecesByProduct = new Map<number, number>();

    for (const input of normalizedInputs) {
      const product = products.find((p) => p.id === input.pid);
      if (!product) {
        throw new NotFoundError(`Produit ID ${input.pid} introuvable`);
      }
      const effectiveUnit: PackagingUnit = input.soldUnit ?? "PIECE";
      if (effectiveUnit !== "PIECE" && effectiveUnit !== product.unitType) {
        throw new BadRequestError(
          `Le produit "${product.name}" ne peut pas être vendu en ${getUnitLabel(effectiveUnit)}.`,
        );
      }
      const multiplier =
        effectiveUnit === "PIECE" ? 1 : Math.max(1, product.unitsPerPack);
      const pieces = input.qty * multiplier;

      requestedPiecesByProduct.set(
        input.pid,
        (requestedPiecesByProduct.get(input.pid) || 0) + pieces,
      );
      const unitKey = `${input.pid}:${effectiveUnit}`;
      qtyByProductAndUnit.set(
        unitKey,
        (qtyByProductAndUnit.get(unitKey) || 0) + input.qty,
      );
    }

    for (const [pid, totalPieces] of requestedPiecesByProduct.entries()) {
      const product = products.find((p) => p.id === pid)!;
      if (product.quantity < totalPieces) {
        throw new BadRequestError(
          `Stock insuffisant pour "${product.name}" (disponible: ${product.quantity} pièces)`,
        );
      }
    }

    // 2. Calcul des prix : ADMIN peut ajuster (> 0), EMPLOYEE reçoit le prix du palier serveur
    const resolvedItems = normalizedInputs.map((input) => {
      const product = products.find((p) => p.id === input.pid)!;
      const effectiveUnit: PackagingUnit = input.soldUnit ?? "PIECE";
      const totalQtyInSameUnit =
        qtyByProductAndUnit.get(`${input.pid}:${effectiveUnit}`) || input.qty;

      const computed = computePriceForUnit(
        product,
        totalQtyInSameUnit,
        effectiveUnit,
      );
      const soldUnitPrice =
        userRole === "ADMIN" ? input.rawUnitPrice : computed.price;

      const multiplier =
        effectiveUnit === "PIECE" ? 1 : Math.max(1, product.unitsPerPack);
      const piecesCount = input.qty * multiplier;
      const lineTotal = soldUnitPrice * input.qty;
      const effectivePiecePrice = lineTotal / piecesCount;

      return {
        product,
        soldUnit: effectiveUnit,
        soldQuantity: input.qty,
        soldUnitPrice,
        piecesCount,
        effectivePiecePrice,
        lineTotal,
      };
    });

    const totalAmount = resolvedItems.reduce((sum, i) => sum + i.lineTotal, 0);

    const hasExplicitSplits = Array.isArray(payments) && payments.length > 0;
    const fallbackPaidAmount =
      paidAmount !== undefined && paidAmount !== null && paidAmount !== ""
        ? paidAmount
        : totalAmount;

    const { splits: paymentSplits, totalPaid: paid } = normalizePaymentSplits({
      payments: hasExplicitSplits ? payments : undefined,
      amount: hasExplicitSplits ? undefined : fallbackPaidAmount,
      paymentMethod,
      maxAmount: totalAmount,
      allowZero: true,
    });

    const remaining = Math.max(0, totalAmount - paid);

    // Règle métier : fiche client obligatoire pour toute vente partielle ou à crédit
    if (remaining > 0 && !clientId) {
      throw new BadRequestError(
        "Une fiche client est obligatoire pour une vente partielle ou à crédit.",
      );
    }

    if (clientId) {
      const client = await prisma.client.findFirst({
        where: { id: Number(clientId), shopId },
        select: { id: true },
      });
      if (!client) {
        throw new NotFoundError("Client introuvable");
      }
    }

    const status = getSaleStatus(paid, totalAmount);

    // 3. Transaction atomique (vente + paiements + stock + caisse) avec retry en cas de collision de numéro
    let sale: any = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        sale = await prisma.$transaction(async (tx) => {
          const cashRegister = await tx.cashRegister.findFirst({
            where: { shopId, status: "OPEN" },
          });

          if (!cashRegister) {
            logger.warn(
              `🔒 Vente bloquée — caisse fermée — Shop: ${shopId} — User: ${userId}`,
            );
            throw new BadRequestError(
              "La caisse est fermée. Veuillez ouvrir la caisse avant d'enregistrer une vente.",
              "CASH_CLOSED",
            );
          }

          const invoiceNumber = await generateInvoiceNumberInTx(
            tx,
            shopId,
            attempt,
          );

          // Décrément atomique du stock par produit agrégé (en pièces)
          for (const [pid, totalPieces] of requestedPiecesByProduct.entries()) {
            const updated = await tx.product.updateMany({
              where: {
                id: pid,
                shopId,
                isActive: true,
                quantity: { gte: totalPieces },
              },
              data: { quantity: { decrement: totalPieces } },
            });
            if (updated.count === 0) {
              const p = products.find((prod) => prod.id === pid)!;
              throw new BadRequestError(
                `Stock insuffisant pour "${p.name}"`,
              );
            }
          }

          const newSale = await tx.sale.create({
            data: {
              shopId,
              userId,
              clientId: clientId ? Number(clientId) : null,
              customerName: customerName?.trim() || null,
              invoiceNumber,
              totalAmount,
              paidAmount: paid,
              remaining,
              status,
              note: note || null,
              items: {
                create: resolvedItems.map((item) => ({
                  productId: item.product.id,
                  productName: item.product.name,
                  productImageUrl: item.product.imageUrl,
                  quantity: item.piecesCount,
                  unitPrice: item.effectivePiecePrice,
                  soldUnit: item.soldUnit,
                  soldQuantity: item.soldQuantity,
                  soldUnitPrice: item.soldUnitPrice,
                  totalAmount: item.lineTotal,
                })),
              },
              ...(paymentSplits.length > 0
                ? {
                    payments: {
                      create: paymentSplits.map((split) => ({
                        amount: split.amount,
                        note:
                          paymentSplits.length > 1
                            ? "Paiement initial (mixte)"
                            : "Paiement initial",
                        paymentMethod: split.paymentMethod,
                      })),
                    },
                  }
                : {}),
            },
            include: {
              client: true,
              items: { include: { product: true } },
              payments: { orderBy: { paidAt: "asc" } },
            },
          });

          for (const item of resolvedItems) {
            const unitSuffix =
              item.soldUnit === "PIECE"
                ? ""
                : ` (${item.soldQuantity} ${getUnitLabel(item.soldUnit, item.soldQuantity > 1)})`;
            await tx.stockMovement.create({
              data: {
                shopId,
                productId: item.product.id,
                userId,
                type: "SALE",
                quantity: item.piecesCount,
                note: `Vente ${invoiceNumber}${unitSuffix}`,
              },
            });
          }

          // Encaissement en caisse DANS la transaction (1 ligne par mode de paiement)
          if (paymentSplits.length > 0) {
            const clientLabel =
              newSale.client?.name || newSale.customerName || "Client";
            for (const split of paymentSplits) {
              await tx.cashTransaction.create({
                data: {
                  cashRegisterId: cashRegister.id,
                  type: "IN",
                  amount: split.amount,
                  label: `Vente ${invoiceNumber} — ${clientLabel}`,
                  reference: invoiceNumber,
                  paymentMethod: split.paymentMethod,
                },
              });
            }
            await tx.cashRegister.update({
              where: { id: cashRegister.id },
              data: { totalIn: { increment: paid } },
            });
          }

          return newSale;
        });
        break;
      } catch (err: any) {
        if (err?.code === "P2002" && attempt < 4) {
          continue;
        }
        throw err;
      }
    }

    // Alertes stock SSE après commit réussi
    const hasStockAlertFeature =
      subscription.features.includes("LOW_STOCK_ALERT") ||
      subscription.features.includes("OUT_OF_STOCK_ALERT");

    if (hasStockAlertFeature) {
      const updatedProducts = await prisma.product.findMany({
        where: { id: { in: uniqueProductIds }, shopId },
        select: { id: true, name: true, quantity: true, alertThreshold: true },
      });

      const lowStock = updatedProducts.filter(
        (p) => p.quantity > 0 && p.quantity <= p.alertThreshold,
      );
      const outOfStock = updatedProducts.filter((p) => p.quantity === 0);

      if (lowStock.length > 0 || outOfStock.length > 0) {
        sendNotificationToShop(shopId, "stock_alert", {
          type: "after_sale",
          invoiceNumber: sale.invoiceNumber,
          lowStock,
          outOfStock,
          total: lowStock.length + outOfStock.length,
        });
      }
    }

    logger.info(
      `🛒 Vente créée — ${sale.invoiceNumber} — Total: ${totalAmount} FCFA — Payé: ${paid} FCFA — Shop: ${shopId}`,
    );

    return sale;
  },

  /**
   * Ajoute un paiement sur une vente / facture dans une seule transaction (caisse ouverte obligatoire).
   * Unifie PATCH /sales/:id/payment et PATCH /invoices/:id/payment.
   */
  addPayment: async (
    shopId: number,
    saleId: number,
    amount?: number | string,
    note?: string,
    paymentMethod = "CASH",
    payments?: PaymentSplitInput[],
  ) => {
    const { splits: paymentSplits, totalPaid: paymentAmount } =
      normalizePaymentSplits({
        payments,
        amount,
        paymentMethod,
        allowZero: false,
      });

    const updatedSale = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: saleId, shopId },
        include: { client: true },
      });
      if (!sale) {
        throw new NotFoundError("Facture introuvable");
      }
      if (sale.status === "CANCELLED") {
        throw new BadRequestError("Impossible d'encaisser une facture annulée");
      }
      if (sale.remaining <= 0) {
        throw new BadRequestError("Cette facture est déjà totalement soldée");
      }
      if (paymentAmount > sale.remaining + 0.001) {
        throw new BadRequestError(
          `Le montant dépasse le reste à payer (${sale.remaining} FCFA)`,
        );
      }

      const cashRegister = await tx.cashRegister.findFirst({
        where: { shopId, status: "OPEN" },
      });
      if (!cashRegister) {
        throw new BadRequestError(
          "La caisse est fermée. Veuillez ouvrir la caisse avant d'enregistrer un paiement.",
          "CASH_CLOSED",
        );
      }

      const newPaid = sale.paidAmount + paymentAmount;
      const newRemaining = Math.max(0, sale.remaining - paymentAmount);
      const newStatus = getSaleStatus(newPaid, sale.totalAmount);

      for (const split of paymentSplits) {
        await tx.salePayment.create({
          data: {
            saleId,
            amount: split.amount,
            note: note || null,
            paymentMethod: split.paymentMethod,
          },
        });
      }

      const updated = await tx.sale.update({
        where: { id: saleId },
        data: {
          paidAmount: newPaid,
          remaining: newRemaining,
          status: newStatus,
        },
        include: {
          client: true,
          items: { include: { product: true } },
          payments: { orderBy: { paidAt: "asc" } },
        },
      });

      const clientLabel =
        updated.client?.name || updated.customerName || "Client";
      for (const split of paymentSplits) {
        await tx.cashTransaction.create({
          data: {
            cashRegisterId: cashRegister.id,
            type: "IN",
            amount: split.amount,
            label: `Règlement facture ${sale.invoiceNumber || `#${saleId}`} — ${clientLabel}`,
            reference: sale.invoiceNumber || String(saleId),
            paymentMethod: split.paymentMethod,
          },
        });
      }
      await tx.cashRegister.update({
        where: { id: cashRegister.id },
        data: { totalIn: { increment: paymentAmount } },
      });

      return updated;
    });

    const methodsSummary = paymentSplits
      .map((s) => `${s.paymentMethod}:${s.amount}`)
      .join(", ");
    logger.info(
      `💰 Paiement ajouté — Vente #${saleId} — Montant: ${paymentAmount} FCFA (${methodsSummary}) — Shop: ${shopId}`,
    );

    return updatedSale;
  },

  /**
   * Annule une vente sans la supprimer (statut CANCELLED) :
   * - Restaure le stock et trace les mouvements
   * - Exige une caisse ouverte si un montant avait été encaissé
   * - Rembourse en caisse par moyen de paiement d'origine
   * - Conserve la facture et ses paiements pour la traçabilité et la continuité de numérotation
   */
  cancelSale: async (shopId: number, userId: number, saleId: number) => {
    const cancelled = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: saleId, shopId },
        include: { items: true, payments: true },
      });

      if (!sale) {
        throw new NotFoundError("Vente introuvable");
      }
      if (sale.status === "CANCELLED") {
        throw new BadRequestError("Cette vente est déjà annulée");
      }

      if (sale.paidAmount > 0) {
        const cashRegister = await tx.cashRegister.findFirst({
          where: { shopId, status: "OPEN" },
        });
        if (!cashRegister) {
          throw new BadRequestError(
            "La caisse est fermée. Veuillez ouvrir la caisse pour annuler et rembourser cette vente.",
            "CASH_CLOSED",
          );
        }

        // Regrouper les paiements par moyen de paiement d'origine
        const refundByMethod = new Map<string, number>();
        if (sale.payments.length > 0) {
          for (const p of sale.payments) {
            const method = p.paymentMethod || "CASH";
            refundByMethod.set(method, (refundByMethod.get(method) || 0) + p.amount);
          }
        } else {
          refundByMethod.set("CASH", sale.paidAmount);
        }

        let totalRefund = 0;
        for (const [method, amount] of refundByMethod.entries()) {
          if (amount <= 0) continue;
          totalRefund += amount;
          await tx.cashTransaction.create({
            data: {
              cashRegisterId: cashRegister.id,
              type: "OUT",
              amount,
              label: `Annulation vente ${sale.invoiceNumber || `#${saleId}`}`,
              reference: sale.invoiceNumber || String(saleId),
              paymentMethod: method,
            },
          });
        }

        if (totalRefund > 0) {
          await tx.cashRegister.update({
            where: { id: cashRegister.id },
            data: { totalOut: { increment: totalRefund } },
          });
        }
      }

      // Restaurer le stock
      for (const item of sale.items) {
        if (item.productId) {
          await tx.product.update({
            where: { id: item.productId },
            data: { quantity: { increment: item.quantity } },
          });
          await tx.stockMovement.create({
            data: {
              shopId,
              productId: item.productId,
              userId,
              type: "ENTRY",
              quantity: item.quantity,
              note: `Annulation vente ${sale.invoiceNumber || `#${saleId}`}`,
            },
          });
        }
      }

      return tx.sale.update({
        where: { id: saleId },
        data: {
          status: "CANCELLED",
          remaining: 0,
        },
        include: {
          client: true,
          items: { include: { product: true } },
          payments: { orderBy: { paidAt: "asc" } },
        },
      });
    });

    logger.warn(`🚫 Vente annulée (statut CANCELLED) — ID: ${saleId} — Shop: ${shopId}`);
    return cancelled;
  },
};
