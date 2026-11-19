-- DropIndex
DROP INDEX IF EXISTS "sales_invoiceNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "sales_shopId_invoiceNumber_key" ON "sales"("shopId", "invoiceNumber");
