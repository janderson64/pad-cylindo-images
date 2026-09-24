import type { Prisma } from "@prisma/client";

import prisma from "../db.server";
import type { SyncSummary } from "./sync-variant-images.server";

export type SyncJobRecord = {
  id: string;
  createdAt: string;
  skuInput: string;
  variantsRequested: number;
  syncedCount: number;
  skippedHasImageCount: number;
  skippedMissingMetafieldsCount: number;
  failedCount: number;
  statusMessage: string | null;
};

export async function createSyncJob(
  shop: string,
  skuInput: string,
  summary: SyncSummary,
): Promise<void> {
  await prisma.syncJob.create({
    data: {
      shop,
      skuInput,
      variantsRequested: summary.variantsRequested,
      syncedCount: summary.synced.length,
      skippedHasImageCount: summary.skippedHasImage.length,
      skippedMissingMetafieldsCount: summary.skippedMissingMetafields.length,
      failedCount: summary.failed.length,
      statusMessage: summary.statusMessage ?? null,
      results: summary as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function createSyncJobFromCounts(
  shop: string,
  skuInput: string,
  counts: {
    variantsRequested: number;
    syncedCount: number;
    skippedHasImageCount: number;
    skippedMissingMetafieldsCount: number;
    failedCount: number;
    statusMessage?: string | null;
  },
): Promise<void> {
  await prisma.syncJob.create({
    data: {
      shop,
      skuInput,
      variantsRequested: counts.variantsRequested,
      syncedCount: counts.syncedCount,
      skippedHasImageCount: counts.skippedHasImageCount,
      skippedMissingMetafieldsCount: counts.skippedMissingMetafieldsCount,
      failedCount: counts.failedCount,
      statusMessage: counts.statusMessage ?? null,
      results: {
        aggregatedFromProductSync: true,
      },
    },
  });
}

export async function listSyncJobs(
  shop: string,
  limit = 20,
): Promise<SyncJobRecord[]> {
  const jobs = await prisma.syncJob.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      skuInput: true,
      variantsRequested: true,
      syncedCount: true,
      skippedHasImageCount: true,
      skippedMissingMetafieldsCount: true,
      failedCount: true,
      statusMessage: true,
    },
  });

  return jobs.map((job) => ({
    ...job,
    createdAt: job.createdAt.toISOString(),
  }));
}
