-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "skuInput" TEXT NOT NULL,
    "variantsRequested" INTEGER NOT NULL,
    "syncedCount" INTEGER NOT NULL,
    "skippedHasImageCount" INTEGER NOT NULL,
    "skippedMissingMetafieldsCount" INTEGER NOT NULL,
    "failedCount" INTEGER NOT NULL,
    "statusMessage" TEXT,
    "results" JSONB NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncJob_shop_createdAt_idx" ON "SyncJob"("shop", "createdAt" DESC);
