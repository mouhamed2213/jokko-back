import { prisma } from "../../config/prisma.js";
import { BadRequestError, NotFoundError } from "../../utils/errors.js";

export const CategoryService = {
  list: async (shopId: number) => {
    return prisma.category.findMany({
      where: { shopId },
      include: { _count: { select: { products: true } } },
      orderBy: { name: "asc" },
    });
  },

  create: async (shopId: number, name: string | undefined) => {
    if (!name?.trim()) {
      throw new BadRequestError("Le nom est obligatoire");
    }
    try {
      return await prisma.category.create({
        data: { shopId, name: name.trim() },
      });
    } catch (error: any) {
      if (error?.code === "P2002") {
        throw new BadRequestError("Cette catégorie existe déjà");
      }
      throw error;
    }
  },

  remove: async (shopId: number, id: number) => {
    const existing = await prisma.category.findFirst({
      where: { id, shopId },
    });
    if (!existing) {
      throw new NotFoundError("Catégorie introuvable");
    }
    await prisma.category.delete({ where: { id } });
  },
};
