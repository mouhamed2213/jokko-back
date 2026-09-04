import { prisma } from "../config/prisma.js";
import { upload } from "../config/storage.config.js";
import { UploadService } from "../modules/uploads/upload.service.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../utils/errors.js";
import { cleanPath, validateFile } from "../utils/file-upload.js";
import { PlanChecker } from "./plan-checker.service.js";

export type CreateProductInput = {
  shopOwnerId: number;
  shopId: number;
  userId: number;
  name: string;
  description?: string;
  reference?: string;
  categoryId?: string;
  purchasePrice: number;
  salePrice: number;
  quantity?: number;
  alertThreshold?: number;
  imageUrl?: string | null;
  semiWholesalePrice?: number;
  semiWholesaleMinQty?: number;
  wholesalePrice?: number;
  wholesaleMinQty?: number;
  supplierId?: number;
  unitCost?: number;
  paidAmount?: number;
  createDebt?: boolean;
};

export const ProductService = {
  async createProduct(input: CreateProductInput) {
    const {
      shopOwnerId,
      shopId,
      userId,
      name,
      description,
      reference,
      categoryId,
      purchasePrice,
      salePrice,
      quantity = 0,
      alertThreshold = 5,
      imageUrl,
      semiWholesalePrice,
      semiWholesaleMinQty,
      wholesalePrice,
      wholesaleMinQty,
      supplierId,
      unitCost,
      paidAmount = 0,
      createDebt = false,
    } = input;
    const shop = await PlanChecker.plan(shopId, shopOwnerId);
    const subscription = shop;

    const currentProducts = await prisma.product.count({
      where: { shopId },
    });

    if (!subscription) {
      return;
    }

    const maxProducts = subscription.limits.products ?? 50;

    if (currentProducts >= maxProducts) {
      throw new ForbiddenError(
        `Vous avez atteint la limite de ${maxProducts} produits autorisés par votre abonnement.`,
      );
    }

    const qty = Number(quantity) || 0;
    const cost = unitCost ? Number(unitCost) : null;
    const paid = Number(paidAmount) || 0;

    return prisma.$transaction(async (tx) => {
      if (supplierId) {
        const supplier = await tx.supplier.findFirst({
          where: { id: supplierId, shopId },
        });
        if (!supplier) {
          throw new NotFoundError("Fournisseur introuvable");
        }
      }

      if (createDebt && (!supplierId || !cost || cost <= 0)) {
        throw new BadRequestError(
          "Un fournisseur et un coût unitaire sont obligatoires pour créer une dette",
        );
      }

      const product = await tx.product.create({
        data: {
          shopId,
          name,
          description: description || null,
          reference: reference || null,
          categoryId: categoryId ? Number(categoryId) : null,
          quantity: 0,
          purchasePrice: Number(purchasePrice),
          salePrice: Number(salePrice),
          alertThreshold: Number(alertThreshold) || 5,
          imageUrl: imageUrl || null,
          semiWholesalePrice: semiWholesalePrice
            ? Number(semiWholesalePrice)
            : null,
          semiWholesaleMinQty: semiWholesaleMinQty
            ? Number(semiWholesaleMinQty)
            : null,
          wholesalePrice: wholesalePrice ? Number(wholesalePrice) : null,
          wholesaleMinQty: wholesaleMinQty ? Number(wholesaleMinQty) : null,
        },
      });

      if (qty <= 0) {
        return tx.product.findUniqueOrThrow({
          where: { id: product.id },
          include: { category: true },
        });
      }

      const totalCost = cost ? cost * qty : null;
      const updatedProduct = await tx.product.update({
        where: { id: product.id },
        data: { quantity: qty },
      });

      await tx.stockMovement.create({
        data: {
          shopId,
          productId: product.id,
          userId,
          supplierId: supplierId || null,
          type: "ENTRY",
          quantity: qty,
          unitCost: cost,
          note: "Stock initial",
        },
      });

      if (supplierId && createDebt && totalCost && totalCost > 0) {
        const remaining = totalCost - paid;
        const debt = await tx.supplierDebt.create({
          data: {
            supplierId,
            totalAmount: totalCost,
            paidAmount: paid,
            remaining: remaining > 0 ? remaining : 0,
            status: remaining <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID",
            note: `Approvisionnement — ${name} x${qty}`,
          },
        });

        if (paid > 0) {
          await tx.supplierPayment.create({
            data: {
              debtId: debt.id,
              amount: paid,
              note: "Acompte à la livraison",
            },
          });

          const cashRegister = await tx.cashRegister.findFirst({
            where: { shopId, status: "OPEN" },
          });
          if (cashRegister) {
            await tx.cashTransaction.create({
              data: {
                cashRegisterId: cashRegister.id,
                type: "OUT",
                amount: paid,
                label: `Acompte fournisseur — ${name} x${qty}`,
                reference: String(supplierId),
              },
            });
            await tx.cashRegister.update({
              where: { id: cashRegister.id },
              data: { totalOut: { increment: paid } },
            });
          }
        }
      }

      return tx.product.findUniqueOrThrow({
        where: { id: updatedProduct.id },
        include: { category: true },
      });
    });
  },


};
