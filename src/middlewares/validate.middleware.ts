import type { NextFunction, Request, Response } from "express";
import { BadRequestError } from "../utils/errors.js";

export type FieldRule = {
  type: "string" | "email" | "number" | "integer" | "boolean" | "enum" | "array";
  required?: boolean;
  label?: string;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  values?: readonly string[];
};

export type BodySchema = Record<string, FieldRule>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePayload(
  body: Record<string, unknown>,
  schema: BodySchema,
): string | null {
  for (const [field, rule] of Object.entries(schema)) {
    const label = rule.label || field;
    const raw = body?.[field];
    const isEmpty =
      raw === undefined ||
      raw === null ||
      (typeof raw === "string" && raw.trim() === "");

    if (isEmpty) {
      if (rule.required) {
        return `Le champ "${label}" est obligatoire.`;
      }
      continue;
    }

    switch (rule.type) {
      case "string": {
        if (typeof raw !== "string") {
          return `Le champ "${label}" doit être une chaîne de caractères.`;
        }
        const trimmed = raw.trim();
        if (rule.minLength !== undefined && trimmed.length < rule.minLength) {
          return `Le champ "${label}" doit contenir au moins ${rule.minLength} caractères.`;
        }
        if (rule.maxLength !== undefined && trimmed.length > rule.maxLength) {
          return `Le champ "${label}" ne doit pas dépasser ${rule.maxLength} caractères.`;
        }
        break;
      }
      case "email": {
        if (typeof raw !== "string" || !EMAIL_RE.test(raw.trim())) {
          return `Le champ "${label}" doit être une adresse email valide.`;
        }
        break;
      }
      case "number":
      case "integer": {
        const num = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(num)) {
          return `Le champ "${label}" doit être un nombre valide.`;
        }
        if (rule.type === "integer" && !Number.isInteger(num)) {
          return `Le champ "${label}" doit être un entier.`;
        }
        if (rule.min !== undefined && num < rule.min) {
          return `Le champ "${label}" doit être supérieur ou égal à ${rule.min}.`;
        }
        if (rule.max !== undefined && num > rule.max) {
          return `Le champ "${label}" doit être inférieur ou égal à ${rule.max}.`;
        }
        break;
      }
      case "boolean": {
        if (typeof raw !== "boolean") {
          return `Le champ "${label}" doit être un booléen.`;
        }
        break;
      }
      case "enum": {
        if (
          typeof raw !== "string" ||
          !rule.values ||
          !rule.values.includes(raw)
        ) {
          return `Valeur invalide pour "${label}".`;
        }
        break;
      }
      case "array": {
        if (!Array.isArray(raw)) {
          return `Le champ "${label}" doit être une liste.`;
        }
        if (rule.minLength !== undefined && raw.length < rule.minLength) {
          return `Le champ "${label}" doit contenir au moins ${rule.minLength} élément(s).`;
        }
        break;
      }
    }
  }
  return null;
}

export const validateBody =
  (schema: BodySchema) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const error = validatePayload(req.body ?? {}, schema);
    if (error) {
      return next(new BadRequestError(error));
    }
    return next();
  };

export const validateNumericParams =
  (...paramNames: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    for (const name of paramNames) {
      const value = req.params[name];
      if (typeof value !== "string" || !/^\d+$/.test(value) || Number(value) <= 0) {
        return next(
          new BadRequestError(`Identifiant invalide (${name}).`),
        );
      }
    }
    return next();
  };
