import { isBlockedStatus } from "../../helpers/shop-status.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { logger } from "../../config/logger.js";
import { prisma } from "../../config/prisma.js";

import {
  CurrentShopType,
  PlanType,
  SubscriptionStatus,
} from "../../database/prisma/generated/prisma/enums.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/errors.js";
import { env } from "../../config/env-config.js";
import {
  cleanPath,
  getFullStorageUrl,
  validateFile,
} from "../../utils/file-upload.js";
import { LOGO_BUCKET } from "../../config/storage.config.js";
import { UploadService } from "../uploads/upload.service.js";
import { AccountAuthService } from "../email/account-auth.service.js";

export const ShopService = {
  createShop: async (
    shopName: string,
    ownerName: string,
    email: string,
    phone: string,
    address: string | null,
    hashedPassword: string,
    planType: PlanType,
  ) => {
    try {
      let endDate: Date | null;
      let subscriptionStatus: SubscriptionStatus;

      //  all plan except free has a 15 days free trial
      if (planType !== "FREE") {
        endDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
        subscriptionStatus = "TRIAL";
      } else {
        endDate = null;
        subscriptionStatus = "ACTIVE";
      }

      const shop = await prisma.$transaction(async (tx) => {
        // Create shop
        const newShop = await tx.shop.create({
          data: {
            name: shopName,
            ownerName,
            email,
            phone: phone,
            address: address || null,
            currentShop: "PRIMARY",
          },
        });

        
        // Find existing plan
        const plan = await tx.plan.findUnique({
          where: {
            code: planType,
          },
        });
        
        if (!plan) {
          throw new NotFoundError("Plan not found");
        }
     
        // Create subscription

        const actor = await tx.user.create({
          data: {
            shopId: newShop.id,
            name: ownerName,
            email,
            password: hashedPassword,
            role: "ADMIN",
          },
        });

        const owner = await tx.shopOwner.create({
          data: {
            userId: actor.id,
            shopId: newShop.id,
            phone: newShop.phone,
          },
        });



        await tx.subscription.create({
          data: {
            shopId: owner.shopId,
            shopOwnerId: owner.id,
            planId: plan.id,
            status: subscriptionStatus,
            endDate,
          },
        });

        return newShop;
      });
      return shop;
    } catch (e) {
      console.error("Error while creating a shop");
      throw e;
    }
  },

  createSecondaryShop: async (
    ownerId: number,
    actorId: number,
    shopData: {
      shopName: string;
      ownerName: string;
      address?: string;
      phone: string;
      email: string;
      manager?: { name: string; email: string; password: string } | null;
    },
  ) => {
    const [owner, actor] = await Promise.all([
      prisma.user.findUnique({
        where: { id: ownerId },
        include: {
          shop: {
            include: {
              subscriptions: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 1,
                include: { plan: true },
              },
            },
          },
        },
      }),
      prisma.user.findUnique({
        where: { id: actorId },
        select: { id: true, shopId: true, role: true },
      }),
    ]);

    if (!owner) throw new NotFoundError("Propriétaire introuvable");
    if (!actor || actor.id !== ownerId || actor.shopId !== owner.shopId || actor.role !== "ADMIN") {
      throw new ForbiddenError("Seul le propriétaire principal peut créer une boutique secondaire");
    }

    const primarySubscription = owner.shop.subscriptions[0];
    if (!primarySubscription) {
      throw new NotFoundError("Abonnement de la boutique principale introuvable");
    }

    const plan = primarySubscription.plan;
    if (plan.code !== "PREMIUM" && plan.code !== "PRO") {
      throw new ForbiddenError("L'abonnement ne comprend pas l'option multi-boutique");
    }
    if (primarySubscription.status !== "ACTIVE") {
      throw new ForbiddenError("L'abonnement de la boutique principale doit être actif");
    }
    if (primarySubscription.endDate && primarySubscription.endDate <= new Date()) {
      throw new ForbiddenError("L'abonnement de la boutique principale a expiré");
    }

    const shopEmail = shopData.email.trim().toLowerCase();
    const managerEmail = shopData.manager?.email.trim().toLowerCase();
    const [existingShop, existingManager] = await Promise.all([
      prisma.shop.findUnique({ where: { email: shopEmail } }),
      managerEmail
        ? prisma.user.findUnique({ where: { email: managerEmail } })
        : Promise.resolve(null),
    ]);
    if (existingShop) throw new ConflictError("Une boutique utilise déjà cette adresse email");
    if (existingManager) throw new ConflictError("L'adresse email du responsable est déjà utilisée");

    const ownedShops = await prisma.shopOwner.count({ where: { userId: ownerId } });
    const maxStores = plan.maxStores ?? 1;
    if (ownedShops >= maxStores) {
      throw new ForbiddenError(`Limite de boutiques atteinte (${maxStores})`);
    }

    return prisma.$transaction(async (tx) => {
      const shop = await tx.shop.create({
        data: {
          name: shopData.shopName.trim(),
          ownerName: shopData.ownerName.trim(),
          email: shopEmail,
          address: shopData.address?.trim() || null,
          primaryShopId: owner.shopId,
          currentShop: CurrentShopType.SECONDARY,
          phone: shopData.phone.trim(),
        },
      });

      // Le responsable est facultatif : la boutique reste administrable par son propriétaire.
      if (shopData.manager) {
        await tx.user.create({
          data: {
            shopId: shop.id,
            name: shopData.manager.name.trim(),
            email: managerEmail!,
            password: shopData.manager.password,
            role: "ADMIN",
          },
        });
      }

      await tx.shopOwner.create({
        data: {
          userId: ownerId,
          shopId: shop.id,
          phone: shop.phone,
        },
      });

      return shop;
    });
  },

  find: async (email: string) => {
    try {
      return await prisma.shop.findUnique({ where: { email } });
    } catch (e) {
      console.error("Cannot find shop");
      throw e;
    }
  },

  // getShop
  getShops: async (ownerId: number) => {
    // check shop onwer
    const ownership = await prisma.shopOwner.findMany({
      where: { userId: ownerId },

      select: {
        shop: {
          select: {
            id: true,
            ownerName: true,
            name: true,
            address: true,
            logoUrl: true,
            currentShop: true,
            status: true,
            primaryShop: {
              select: {
                status: true,
                subscriptions: {
                  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                  take: 1,
                  select: { plan: { select: { code: true } } },
                },
              },
            },
            subscriptions: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { plan: { select: { code: true } } },
            },
          },
        },
      },
    });

    if (ownership.length <= 0) {
      throw new ForbiddenError("Access interdit");
    }

    const shops = ownership
      .filter(
        (s) =>
          !isBlockedStatus(s.shop.status) &&
          !isBlockedStatus(s.shop.primaryShop?.status),
      )
      .map((s) => ({
      id: s.shop.id,
      shopOwner: ownerId,
      actorName: s.shop.ownerName,
      name: s.shop.name,
      plan: s.shop.primaryShop
        ? s.shop.primaryShop.subscriptions[0]?.plan.code ?? "FREE"
        : s.shop.subscriptions[0]?.plan.code ?? "FREE",
      address: s.shop.address,
      logoUrl:  getFullStorageUrl(LOGO_BUCKET, s.shop.logoUrl),
      currentShop: s.shop.currentShop,
      }));

    return shops;
  },

  // Le propriétaire principal change de contexte avec ses propres identifiants.
  switchShop: async (
    shopOwnerId: number,
    shopData: { password: string; targetShopId: number },
  ) => {
    const owner = await prisma.user.findUnique({
      where: { id: shopOwnerId },
      select: { id: true, shopId: true, name: true, email: true, password: true, role: true, isActive: true },
    });

    if (!owner || !owner.isActive || owner.role !== "ADMIN") {
      throw new ForbiddenError("Compte propriétaire non autorisé");
    }

    const targetShop = await prisma.shop.findUnique({
      where: { id: shopData.targetShopId },
      include: {
        primaryShop: { select: { id: true, status: true } },
        subscriptions: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { plan: { select: { code: true } } },
        },
      },
    });
    if (!targetShop) throw new NotFoundError("Boutique introuvable");
    if (targetShop.id !== owner.shopId && targetShop.primaryShopId !== owner.shopId) {
      throw new ForbiddenError("Cette boutique n'appartient pas à votre réseau");
    }

    const ownership = await prisma.shopOwner.findFirst({
      where: { userId: owner.id, shopId: targetShop.id },
      select: { id: true },
    });
    if (!ownership) throw new ForbiddenError("Accès non autorisé");

    if (isBlockedStatus(targetShop.status) || isBlockedStatus(targetShop.primaryShop?.status)) {
      throw new ForbiddenError("Cette boutique ou sa boutique principale est archivée");
    }

    const billingShop = targetShop.primaryShopId
      ? await prisma.shop.findUnique({
          where: { id: targetShop.primaryShopId },
          include: {
            subscriptions: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { plan: { select: { code: true } } },
            },
          },
        })
      : targetShop;
    const inheritedPlanCode = billingShop?.subscriptions[0]?.plan.code;
    if (!inheritedPlanCode) throw new NotFoundError("Abonnement de la boutique principale introuvable");

    const isPasswordValid = await bcrypt.compare(shopData.password, owner.password);
    if (!isPasswordValid) throw new ForbiddenError("Mot de passe incorrect");

    const token = jwt.sign(
      {
        ownerId: owner.id,
        userId: owner.id,
        shopId: targetShop.id,
        planType: inheritedPlanCode,
        role: owner.role,
        email: owner.email,
        ...(targetShop.id !== owner.shopId ? { accessMode: "OWNER" as const } : {}),
      },
      env.secret.jwt,
      { expiresIn: "1d" },
    );

    return {
      token,
      user: {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        role: owner.role,
        plan: inheritedPlanCode,
        shopId: targetShop.id,
        shopName: targetShop.name,
      },
    };
  },

  registerPrimaryShop: async (payload: {
    shopName?: string;
    ownerName?: string;
    email?: string;
    phone?: string;
    address?: string;
    adminPassword?: string;
    currentShop?: string;
    planType?: PlanType;
  }) => {
    const {
      shopName,
      ownerName,
      email,
      phone,
      address,
      adminPassword,
      currentShop,
      planType,
    } = payload;

    if (!shopName || !ownerName || !email || !adminPassword || !planType) {
      throw new BadRequestError("Champs obligatoires manquants");
    }

    const existingShop = await ShopService.find(email);
    if (existingShop && currentShop === "PRIMARY") {
      throw new BadRequestError("Une boutique avec cet email existe déjà");
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const shop = await ShopService.createShop(
      shopName,
      ownerName,
      email,
      phone || "",
      address || "",
      hashedPassword,
      planType,
    );

    const ownerAccount = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (ownerAccount) {
      try {
        await AccountAuthService.requestEmailVerification(
          "USER",
          ownerAccount.id,
        );
      } catch (emailError) {
        logger.error(
          "Boutique créée, mais email de vérification du propriétaire non envoyé",
          {
            userId: ownerAccount.id,
            error:
              emailError instanceof Error
                ? emailError.message
                : "Erreur inconnue",
          },
        );
      }
    }

    logger.info(`🏪 Nouvelle boutique créée — "${shopName}" — Email: ${email}`);
    return shop;
  },

  registerSecondaryShop: async (
    ownerId: number,
    userId: number,
    body: Record<string, any>,
  ) => {
    const { manager, ...shopData } = body;
    if (
      !shopData.shopName ||
      !shopData.ownerName ||
      !shopData.phone ||
      !shopData.email
    ) {
      throw new BadRequestError(
        "Nom, propriétaire, téléphone et email de la boutique sont obligatoires",
      );
    }

    let managerPayload: { name: string; email: string; password: string } | null =
      null;
    if (manager) {
      if (
        !manager.name ||
        !manager.email ||
        !manager.password ||
        String(manager.password).length < 8
      ) {
        throw new BadRequestError(
          "Nom, email et mot de passe d'au moins 8 caractères obligatoires pour le responsable",
        );
      }
      managerPayload = {
        name: String(manager.name).trim(),
        email: String(manager.email).trim().toLowerCase(),
        password: await bcrypt.hash(String(manager.password), 10),
      };
    }

    const newShop = await ShopService.createSecondaryShop(ownerId, userId, {
      ...shopData,
      manager: managerPayload,
    } as any);

    if (managerPayload) {
      const managerAccount = await prisma.user.findUnique({
        where: { email: managerPayload.email },
        select: { id: true },
      });
      if (managerAccount) {
        try {
          await AccountAuthService.requestEmailVerification(
            "USER",
            managerAccount.id,
          );
        } catch (emailError) {
          logger.error(
            "Boutique secondaire créée, mais email de vérification du responsable non envoyé",
            {
              userId: managerAccount.id,
              error:
                emailError instanceof Error
                  ? emailError.message
                  : "Erreur inconnue",
            },
          );
        }
      }
    }

    logger.info(`🏪 Boutique secondaire créée par User ${userId}`);
    return newShop;
  },

  getSettings: async (shopId: number) => {
    const shopData = await prisma.shop.findUnique({
      where: { id: shopId },
      include: {
        subscriptions: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          include: { plan: true },
        },
        primaryShop: {
          include: {
            subscriptions: {
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              include: { plan: true },
            },
          },
        },
        _count: {
          select: { users: true, products: true, sales: true, clients: true },
        },
      },
    });
    if (!shopData) {
      throw new NotFoundError("Boutique introuvable");
    }

    return {
      ...shopData,
      subscriptions: shopData.primaryShopId
        ? shopData.primaryShop?.subscriptions ?? []
        : shopData.subscriptions,
      subscriptionInherited: !!shopData.primaryShopId,
      billingShopId: shopData.primaryShopId ?? shopData.id,
      logoUrl: getFullStorageUrl(LOGO_BUCKET, shopData.logoUrl as string),
    };
  },

  updateSettings: async (
    shopId: number,
    ownerId: number,
    payload: {
      name?: string;
      ownerName?: string;
      phone?: string;
      address?: string;
    },
  ) => {
    const { name, ownerName, phone, address } = payload;
    if (!name || !ownerName || !phone) {
      throw new BadRequestError(
        "Nom boutique, nom propriétaire et numéro obligatoires",
      );
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.shop.update({
        where: { id: shopId },
        data: {
          name: name.trim(),
          ownerName: ownerName.trim(),
          phone: phone.trim(),
          address: address?.trim() || null,
        },
      });

      await tx.shopOwner.updateMany({
        where: { shopId, userId: ownerId },
        data: { phone: updated.phone },
      });

      return updated;
    });
  },

  uploadLogo: async (shopId: number, file?: Express.Multer.File) => {
    if (!file) {
      throw new BadRequestError("Aucun fichier reçu");
    }
    validateFile(file);
    const generatePath = cleanPath(file);
    const logoPath = await UploadService.uploadFile(file, generatePath, "logo");

    const shop = await prisma.shop.update({
      where: { id: shopId },
      data: { logoUrl: logoPath.path },
    });

    return { generatePath, shop };
  },

  deleteLogo: async (shopId: number) => {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { logoUrl: true },
    });
    if (!shop) {
      throw new NotFoundError("Boutique introuvable");
    }

    const data = await UploadService.deleteFile(
      LOGO_BUCKET,
      shop.logoUrl ?? "",
    );
    if (!data || data.length === 0) {
      logger.warn(
        `Aucun fichier trouvé à supprimer dans '${LOGO_BUCKET}' au chemin : ${shop.logoUrl}`,
      );
    }

    await prisma.shop.update({
      where: { id: shopId },
      data: { logoUrl: null },
    });
  },
};
