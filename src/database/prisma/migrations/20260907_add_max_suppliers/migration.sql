-- This is an empty migration.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "maxSuppliers" INTEGER;
