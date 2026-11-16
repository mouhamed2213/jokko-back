import bcrypt from "bcrypt";
import { NextFunction, Response } from "express";
import { prisma } from "../config/prisma.js";
import { AuthRequest } from "../middlewares/auth.middleware.js";
import { UserService } from "../services/user.service.js";
import { UnauthorizedError } from "../utils/errors.js";

export const getUsers = async (req: AuthRequest, res: Response , next : NextFunction) => {
  try {
    const shopId = req.user!.shopId;
    const users = await prisma.user.findMany({
      where: { shopId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json(users);
  } catch (error) {
    return res.status(500).json({ message: "Erreur récupération utilisateurs", error });
  }
};

// Create user
export const createUser = async (req: AuthRequest, res: Response , next  : NextFunction) => {
  try {
    const u = req.user;
    if(!u){
      throw new UnauthorizedError("Token invalid ou à éxpiré")
    }
    const { name, email, password, role } = req.body;

    
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Nom, email et mot de passe obligatoires" });
    }

    // return res.status(201).json({ message: "Plan", planChecker });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await UserService.createUser(
      u.ownerId,
      u.shopId,
      name,
      email,
      hashedPassword,
      role,
    );
    return res.status(201).json({ message: "Utilisateur créé", user });
}catch (e) {
  next(e)
}
};

export const updateUser = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);
    const { name, role, isActive, password } = req.body;

    const existing = await prisma.user.findFirst({ where: { id, shopId } });
    if (!existing) return res.status(404).json({ message: "Utilisateur introuvable" });

    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { currentShop: true },
    });
    if (shop?.currentShop === "SECONDARY" && existing.role === "ADMIN" && role && role !== "ADMIN") {
      return res.status(409).json({
        message: "Le rôle du responsable principal de cette boutique ne peut pas être rétrogradé.",
      });
    }

    const data: any = {};
    if (name) data.name = name;
    if (role) data.role = role === "ADMIN" ? "ADMIN" : "EMPLOYEE";
    if (isActive !== undefined) {
      if (typeof isActive !== "boolean") {
        return res.status(400).json({ message: "Le statut doit être un booléen" });
      }
      if (id === req.user!.userId && isActive === false) {
        return res.status(400).json({ message: "Vous ne pouvez pas désactiver votre propre compte" });
      }
      data.isActive = isActive;
    }
    if (password) data.password = await bcrypt.hash(password, 10);

    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    return res.status(200).json({ message: "Utilisateur modifié", user });
  } catch (error) {
    return res.status(500).json({ message: "Erreur modification utilisateur", error });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = req.user!.shopId;
    const id = Number(req.params.id);
    const currentUserId = req.user!.userId;

    if (id === currentUserId) {
      return res.status(400).json({ message: "Vous ne pouvez pas supprimer votre propre compte" });
    }

    const existing = await prisma.user.findFirst({ where: { id, shopId } });
    if (!existing) return res.status(404).json({ message: "Utilisateur introuvable" });
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { currentShop: true },
    });
    if (shop?.currentShop === "SECONDARY" && existing.role === "ADMIN") {
      return res.status(409).json({
        message: "Le responsable d'une boutique secondaire doit être désactivé, pas supprimé.",
      });
    }

    await prisma.user.delete({ where: { id } });
    return res.status(200).json({ message: "Utilisateur supprimé" });
  } catch (error) {
    return res.status(500).json({ message: "Erreur suppression utilisateur", error });
  }
};