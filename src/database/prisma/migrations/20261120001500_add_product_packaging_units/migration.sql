-- CreateEnum
CREATE TYPE "PackagingUnit" AS ENUM ('PIECE', 'DOZEN', 'CARTON');

-- AlterTable
ALTER TABLE "products"
ADD COLUMN "unitType" "PackagingUnit" NOT NULL DEFAULT 'PIECE',
ADD COLUMN "unitsPerPack" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "packPurchasePrice" DOUBLE PRECISION,
ADD COLUMN "packSalePrice" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "sale_items"
ADD COLUMN "soldUnit" "PackagingUnit" NOT NULL DEFAULT 'PIECE',
ADD COLUMN "soldQuantity" INTEGER,
ADD COLUMN "soldUnitPrice" DOUBLE PRECISION;
