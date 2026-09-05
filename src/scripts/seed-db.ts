import { logger } from "../config/logger.js";
import { prisma } from "../config/prisma.js";
import { FeatureCode, PlanType } from "../database/prisma/generated/prisma/enums.js";

export const seedDb = async () => {
  try {
    // ==================================================
    // Plans
    // ==================================================

    const plans = [
      {
        code: "FREE",
        name: "Free",
        price: 0,
        maxUsers: 1,
        maxProducts: 20,
        maxCustomers: null,
        maxSalesPerMonth: 10,
        maxStores: null,
      },
      {
        code: "BASIC",
        name: "Basic",
        price: 6500,
        maxUsers: 3,
        maxProducts: null,
        maxCustomers: null,
        maxSalesPerMonth: null,
        maxStores: null,
      },
      {
        code: "PRO",
        name: "Pro",
        price: 14000,
        maxUsers: 5,
        maxProducts: null,
        maxCustomers: null,
        maxSalesPerMonth: null,
        maxStores: 2,
      },
      {
        code: "PREMIUM",
        name: "Premium",
        price: 22000,
        maxUsers: null,
        maxProducts: null,
        maxCustomers: null,
        maxSalesPerMonth: null,
        maxStores: 5,
      },
    ];

    for (const plan of plans) {
      const planWithTypedCode= { ...plan , code: plan.code as PlanType }


      await prisma.plan.upsert({
        where: {
          code: plan.code as PlanType,
        },
        create: planWithTypedCode,
        update: planWithTypedCode,
      });
    }

    // Remove deleted plans
    // await prisma.plan.deleteMany({
    //   where: {
    //     code: {
    //       notIn: plans.map((p) => p.code),
    //     },
    //   },
    // });

    // ==================================================
    // Features
    // ==================================================

    const features = [
      { code: "EXPORT_PDF", name: "Export PDF" },
      { code: "EXPORT_EXCEL", name: "Export Excel" },
      { code: "LOW_STOCK_ALERT", name: "Low Stock Alert" },
      { code: "OUT_OF_STOCK_ALERT", name: "Out of Stock Alert" },
      { code: "TOP_PRODUCTS", name: "Top Products" },
      { code: "STOCK_VALUE", name: "Stock Value" },
      { code: "SUPPLIER_MANAGEMENT", name: "Supplier Management" },
      { code: "ADVANCED_REPORTS", name: "Advanced Reports" },
      { code: "ACCOUNTING", name: "Accounting" },
      { code: "MULTI_STORE", name: "Multi Store" },
      { code: "API_ACCESS", name: "API Access" },
    ];

    for (const feature of features) {
      const featureWithTypedCode= { ...feature , code: feature.code as FeatureCode }


      await prisma.feature.upsert({
        where: {
          code: feature.code as  FeatureCode,
        },
        create: featureWithTypedCode,
        update: featureWithTypedCode,
      });
    }

    // Remove deleted features
    // await prisma.feature.deleteMany({
    //   where: {
    //     code: {
    //       notIn: features.map((f) => f.code),
    //     },
    //   },
    // });

    // ==================================================
    // Load ids
    // ==================================================

    const dbPlans = await prisma.plan.findMany();
    const dbFeatures = await prisma.feature.findMany();

    const planMap = Object.fromEntries(
      dbPlans.map((p) => [p.code, p.id])
    );

    const featureMap = Object.fromEntries(
      dbFeatures.map((f) => [f.code, f.id])
    );

    // ==================================================
    // Plan Feature Mapping
    // ==================================================

    const mappings: Record<string, string[]> = {
    FREE: [
  "EXPORT_PDF",
  "EXPORT_EXCEL",
  "LOW_STOCK_ALERT",
  "TOP_PRODUCTS",
  "STOCK_VALUE",
  `OUT_OF_STOCK_ALERT`,
  "SUPPLIER_MANAGEMENT"
],

BASIC: [
  "EXPORT_PDF",
  "EXPORT_EXCEL",
  "LOW_STOCK_ALERT",
  "TOP_PRODUCTS",
  "STOCK_VALUE",
  `OUT_OF_STOCK_ALERT`,
  "SUPPLIER_MANAGEMENT"
],


      PRO: [
        "EXPORT_PDF",
        "EXPORT_EXCEL",
        "LOW_STOCK_ALERT",
        "TOP_PRODUCTS",
        "STOCK_VALUE",
        "SUPPLIER_MANAGEMENT",
        "ADVANCED_REPORTS",
        "ACCOUNTING",
        "MULTI_STORE",
  `OUT_OF_STOCK_ALERT`

      ],

      PREMIUM: [
        "EXPORT_PDF",
        "EXPORT_EXCEL",
        "LOW_STOCK_ALERT",
        "TOP_PRODUCTS",
        "STOCK_VALUE",
        "SUPPLIER_MANAGEMENT",
        "ADVANCED_REPORTS",
        // "ACCOUNTING",
        "MULTI_STORE",
        // "API_ACCESS",
  `OUT_OF_STOCK_ALERT`


      ],
    };

   for (const [planCode, featureCodes] of Object.entries(mappings)) {
  const planId = planMap[planCode];

  // Dédupliquer les codes
  const uniqueFeatureCodes = [...new Set(featureCodes)];

  // Delete existing mappings
  await prisma.planFeature.deleteMany({
    where: { planId },
  });

  // Create fresh mappings
  if (uniqueFeatureCodes.length > 0) {
    await prisma.planFeature.createMany({
      data: uniqueFeatureCodes.map((code) => ({
        planId,
        featureId: featureMap[code],
      })),
        skipDuplicates: true,

    });
  }
}


    logger.info("✅ Database seeded successfully");
  } catch (error) {
    logger.error("❌ Seeding failed", error);
    process.exit(1);
  }
};

 