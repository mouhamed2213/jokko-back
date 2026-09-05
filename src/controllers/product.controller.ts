import { NextFunction, Response } from "express";
import { prisma } from "../config/prisma.js";
import { AuthRequest } from "../middlewares/auth.middleware.js";
import { ProductService } from "./../services/product.service.js";
import {  UploadService } from "../modules/uploads/upload.service.js";
import { cleanPath, getFullStorageUrl, validateFile } from "../utils/file-upload.js";

export const mapProductToDto = (product: any, bucketName: string = "products") => {
  return {
    ...product,
    imageUrl: getFullStorageUrl(bucketName, product.imageUrl),
  };
};

export const getProducts = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const search = typeof req.query.search === "string" ? req.query.search : "";
    const categoryId = req.query.categoryId
      ? Number(req.query.categoryId)
      : undefined;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = { shopId, isActive: true };
    if (search) where.name = { contains: search };
    if (categoryId) where.categoryId = categoryId;

    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: { category: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    // ── Application du Mapper pour formater imageUrl ──
    const formattedProducts = products.map((product) =>
      mapProductToDto(product, "products")
    );

    return res.status(200).json({
      data: formattedProducts,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      totalProducts: total,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur récupération produits", error });
  }
};

export const getProductById = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);

    const product = await prisma.product.findFirst({
      where: { id, shopId },
      include: { category: true },
    });

    if (!product)
      return res.status(404).json({ message: "Produit introuvable" });

    return res.status(200).json(product);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur récupération produit", error });
  }
};
export const createProduct = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const shopId = req.user!.shopId;
    const shopOwnerId = req.user!.ownerId;
    const {
      name,
      description,
      reference,
      categoryId,
      purchasePrice,
      salePrice,
      quantity,
      alertThreshold,
      imageUrl: directImageUrl, // URL de secours si pas de fichier envoyé
      semiWholesalePrice,
      semiWholesaleMinQty,
      wholesalePrice,
      wholesaleMinQty,
      supplierId,
      unitCost,
      paidAmount,
      createDebt,
    } = req.body;

    // return console.log("req.body", req.body);
    if (!name || purchasePrice == null || salePrice == null) {
      return res.status(400).json({
        message: "Nom, prix d'achat et prix de vente sont obligatoires",
      });
    }
    const parsedPaidAmount = Number(paidAmount) || 0;
    if (parsedPaidAmount < 0) {
      return res.status(400).json({ message: "L'acompte ne peut pas être négatif" });
    }
    if (
      (createDebt === true || createDebt === "true") &&
      Number(unitCost || purchasePrice) > 0 &&
      parsedPaidAmount > Number(unitCost || purchasePrice) * (Number(quantity) || 0)
    ) {
      return res.status(400).json({
        message: "L'acompte ne peut pas dépasser le montant total de l'approvisionnement",
      });
    }

    let imageUrl = directImageUrl || null;

    // 1. Traitement du fichier uploadé via Multer (si présent)
    if (req.file) {
      validateFile(req.file);
      const filePath = cleanPath(req.file);
      
      // Upload vers Supabase Storage
      const uploadResult = await UploadService.uploadFile(
        req.file, 
        filePath, 
        "product"
      );

      // On récupère le chemin relatif retourné par Supabase (ex: uploadResult.path)
      imageUrl = uploadResult?.path || uploadResult;
    }

    // 2. Création du produit avec le bon imageUrl
    const product = await ProductService.createProduct({
      shopOwnerId,
      shopId,
      userId: req.user!.userId,
      name,
      description,
      reference,
      categoryId,
      purchasePrice: Number(purchasePrice),
      salePrice: Number(salePrice),
      quantity: Number(quantity) || 0,
      alertThreshold: Number(alertThreshold),
      imageUrl,
      semiWholesalePrice: Number(semiWholesalePrice) || undefined,
      semiWholesaleMinQty: Number(semiWholesaleMinQty) || undefined,
      wholesalePrice: Number(wholesalePrice) || undefined,
      wholesaleMinQty: Number(wholesaleMinQty) || undefined,
      supplierId: Number(supplierId) || undefined,
      unitCost: Number(unitCost) || undefined,
      paidAmount: parsedPaidAmount,
      createDebt: createDebt === true || createDebt === "true",
    });
    return res
      .status(201)
      .json({ message: "Produit créé avec succès", product });
  } catch (e) {
    next(e);
  }
};

export const updateProduct = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);

    // 1. Vérification de l'existence du produit
    const existing = await prisma.product.findFirst({ where: { id, shopId } });
    if (!existing) {
      return res.status(404).json({ message: "Produit introuvable" });
    }

    const {
      name,
      description,
      reference,
      categoryId,
      purchasePrice,
      salePrice,
      quantity,
      alertThreshold,
      imageUrl,
      semiWholesalePrice,
      semiWholesaleMinQty,
      wholesalePrice,
      wholesaleMinQty,
    } = req.body;

    let finalImageUrl = existing.imageUrl;

    // 2. Gestion de l'image Supabase Storage
    if (req.file) {
      // CAS A : Un nouveau fichier est téléversé
      // Supprimer l'ancienne image sur Supabase si elle existe
      if (existing.imageUrl) {
        await UploadService.deleteFile("products", existing.imageUrl);
      }

      // Upload de la nouvelle image
      validateFile(req.file);
      const filePath = cleanPath(req.file);
      const uploadResult = await UploadService.uploadFile(
        req.file,
        filePath,
        'product'
      );

  
      finalImageUrl = uploadResult?.path ;
    } else if (imageUrl === "" || imageUrl === null) {
      // CAS B : L'utilisateur a explicitement retiré l'image
      if (existing.imageUrl) {
        await UploadService.deleteFile("products", existing.imageUrl);
      }
      finalImageUrl = null;
    }

    // 3. Mise à jour dans la base de données
    const updated = await prisma.product.update({
      where: { id },
      data: {
        name: name ?? existing.name,
        description: description !== undefined ? (description || null) : existing.description,
        reference: reference !== undefined ? (reference || null) : existing.reference,
        categoryId:
          categoryId !== undefined
            ? categoryId
              ? Number(categoryId)
              : null
            : existing.categoryId,
        purchasePrice:
          purchasePrice !== undefined
            ? Number(purchasePrice)
            : existing.purchasePrice,
        salePrice:
          salePrice !== undefined ? Number(salePrice) : existing.salePrice,


          quantity: quantity !== undefined ? Number(quantity) : existing.quantity,
        alertThreshold:
          alertThreshold !== undefined
            ? Number(alertThreshold)
            : existing.alertThreshold,
        imageUrl: finalImageUrl,
        semiWholesalePrice:
          semiWholesalePrice !== undefined
            ? semiWholesalePrice
              ? Number(semiWholesalePrice)
              : null
            : existing.semiWholesalePrice,
        semiWholesaleMinQty:
          semiWholesaleMinQty !== undefined
            ? semiWholesaleMinQty
              ? Number(semiWholesaleMinQty)
              : null
            : existing.semiWholesaleMinQty,
        wholesalePrice:
          wholesalePrice !== undefined
            ? wholesalePrice
              ? Number(wholesalePrice)
              : null
            : existing.wholesalePrice,
        wholesaleMinQty:
          wholesaleMinQty !== undefined
            ? wholesaleMinQty
              ? Number(wholesaleMinQty)
              : null
            : existing.wholesaleMinQty,
      },
      include: { category: true },
    });

    // 4. Formater la réponse avec le Mapper DTO (pour renvoyer l'URL publique)
    const formattedProduct = mapProductToDto(updated, "products");

    return res.status(200).json({
      message: "Produit modifié avec succès",
      product: formattedProduct,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur modification produit", error });
  }
};


export const deleteProduct = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);

    const existing = await prisma.product.findFirst({ where: { id, shopId } });
    if (!existing)
      return res.status(404).json({ message: "Produit introuvable" });

    // Soft delete pour préserver l'historique
    await prisma.product.update({ where: { id }, data: { isActive: false } });

    return res.status(200).json({ message: "Produit supprimé avec succès" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur suppression produit", error });
  }
};

export const getLowStockProducts = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const products = await prisma.product.findMany({
      where: { shopId, isActive: true, quantity: { gt: 0 } },
      include: { category: true },
    });

    const lowStock = products.filter((p) => p.quantity <= p.alertThreshold);
    return res.status(200).json(lowStock);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur produits stock faible", error });
  }
};

export const getOutOfStockProducts = async (
  req: AuthRequest,
  res: Response,
) => {
  try {
    const shopId = req.user!.shopId;
    const products = await prisma.product.findMany({
      where: { shopId, isActive: true, quantity: 0 },
      include: { category: true },
      orderBy: { updatedAt: "desc" },
    });
    return res.status(200).json(products);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erreur produits en rupture", error });
  }
};

// ── GET /products/:id/price?quantity=X ───────────────────────
// Retourne le prix suggéré selon la quantité et les niveaux tarifaires
export const getSuggestedPrice = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);
    const quantity = Number(req.query.quantity) || 1;

    const product = await prisma.product.findFirst({
      where: { id, shopId },
      select: {
        salePrice: true,
        semiWholesalePrice: true,
        semiWholesaleMinQty: true,
        wholesalePrice: true,
        wholesaleMinQty: true,
      },
    });

    if (!product)
      return res.status(404).json({ message: "Produit introuvable" });

    const suggested = computePrice(product, quantity);

    return res.status(200).json({
      quantity,
      suggestedPrice: suggested.price,
      tier: suggested.tier,
      tiers: {
        detail: { price: product.salePrice, label: "Détail" },
        semiWholesale: product.semiWholesalePrice
          ? {
              price: product.semiWholesalePrice,
              minQty: product.semiWholesaleMinQty,
              label: "Demi-gros",
            }
          : null,
        wholesale: product.wholesalePrice
          ? {
              price: product.wholesalePrice,
              minQty: product.wholesaleMinQty,
              label: "Gros",
            }
          : null,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Erreur calcul prix", error });
  }
};

// Helper — calcule le prix selon la quantité
export function computePrice(
  product: {
    salePrice: number;
    semiWholesalePrice?: number | null;
    semiWholesaleMinQty?: number | null;
    wholesalePrice?: number | null;
    wholesaleMinQty?: number | null;
  },
  quantity: number,
): { price: number; tier: "detail" | "semiWholesale" | "wholesale" } {
  // Gros (priorité la plus haute)
  if (
    product.wholesalePrice &&
    product.wholesaleMinQty &&
    quantity >= product.wholesaleMinQty
  ) {
    return { price: product.wholesalePrice, tier: "wholesale" };
  }
  // Demi-gros
  if (
    product.semiWholesalePrice &&
    product.semiWholesaleMinQty &&
    quantity >= product.semiWholesaleMinQty
  ) {
    return { price: product.semiWholesalePrice, tier: "semiWholesale" };
  }
  // Détail (par défaut)
  return { price: product.salePrice, tier: "detail" };
}

// upload image
export const uploadProductImage = (req: AuthRequest, res: Response) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: "Aucun fichier reçu" });
  }

  return res.status(200).json({
    message: "Image uploadée avec succès",
    // imageUrl: generateUrl,
    filename: file.filename,
  });
};
