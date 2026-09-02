import { prisma } from "../config/prisma.js";
import { upload } from "../config/storage.config.js";
import { UploadService } from "../modules/uploads/upload.service.js";
import { ForbiddenError } from "../utils/errors.js";
import { cleanPath, validateFile } from "../utils/file-upload.js";
import { PlanChecker } from "./plan-checker.service.js";

export const ProductService = {
  async createProduct(
    shopOwnerId: number,
    shopId: number,
    name: string,
    description: string,
    reference: string,
    categoryId: string,
    purchasePrice: number,
    salePrice: number,
    quantity : number,
    alertThreshold: number,
    imageUrl: string,
    semiWholesalePrice: number,
    semiWholesaleMinQty: number,
    wholesalePrice: number,
    wholesaleMinQty: number,
  ) {
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

    const result = await prisma.product.create({
      data: {
        shopId,
        name,
        description: description || null,
        reference: reference || null,
        categoryId: categoryId ? Number(categoryId) : null,
        quantity: Number(quantity) || 0,
        purchasePrice: Number(purchasePrice),
        salePrice: Number(salePrice),
        alertThreshold: alertThreshold ?? 5,
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
      include: { category: true },
    });

    return result;
  },


};
