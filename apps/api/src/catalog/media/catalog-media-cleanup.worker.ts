import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { CatalogMediaService } from "./catalog-media.service.js";
import type { CatalogMediaObjectPrefix } from "./r2-storage.js";

const CLEANUP_POLL_INTERVAL_MS = 15 * 60_000;
const CLEANUP_RETRY_INTERVAL_MS = 60_000;
const ORPHAN_SCAN_RETRY_INTERVAL_MS = 60 * 60_000;
const CLEANUP_BATCH_SIZE = 100;
const STALE_UPLOAD_RETENTION_MS = 30 * 24 * 60 * 60_000;
const ORPHAN_SCAN_PREFIXES: CatalogMediaObjectPrefix[] = [
  "quarantine/",
  "published/",
];

@Injectable()
export class CatalogMediaCleanupWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(CatalogMediaCleanupWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private activeRun: Promise<number> | undefined;
  private stopping = false;
  private orphanPrefixIndex = 0;
  private orphanContinuationToken: string | undefined;

  constructor(private readonly media: CatalogMediaService) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV !== "test") this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.activeRun?.catch(() => undefined);
  }

  runOnce(): Promise<number> {
    if (this.activeRun) return this.activeRun;
    const cutoff = new Date(Date.now() - STALE_UPLOAD_RETENTION_MS);
    this.activeRun = this.media
      .cleanupStaleUploads(cutoff, CLEANUP_BATCH_SIZE)
      .finally(() => {
        this.activeRun = undefined;
      });
    return this.activeRun;
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => void this.processBatch(), delayMs);
    this.timer.unref();
  }

  private async processBatch(): Promise<void> {
    if (this.stopping) return;
    let count = 0;
    let failed = false;
    let orphanScanFailed = false;
    try {
      count = await this.runOnce();
    } catch {
      failed = true;
      this.logger.error("Stale catalog media cleanup failed.");
    }

    if (!failed) {
      try {
        await this.scanOneOrphanPage();
      } catch {
        orphanScanFailed = true;
        this.logger.error("Catalog media orphan reconciliation failed.");
      }
    }

    this.schedule(
      failed
        ? CLEANUP_RETRY_INTERVAL_MS
        : orphanScanFailed
          ? ORPHAN_SCAN_RETRY_INTERVAL_MS
          : count === CLEANUP_BATCH_SIZE
            ? 0
            : CLEANUP_POLL_INTERVAL_MS,
    );
  }

  private async scanOneOrphanPage(): Promise<void> {
    const prefix = ORPHAN_SCAN_PREFIXES[this.orphanPrefixIndex];
    if (!prefix) throw new Error("Catalog media cleanup prefix is missing.");
    const result = await this.media.cleanupOrphanedMediaObjects({
      cutoff: new Date(Date.now() - STALE_UPLOAD_RETENTION_MS),
      prefix,
      ...(this.orphanContinuationToken
        ? { continuationToken: this.orphanContinuationToken }
        : {}),
      batchSize: CLEANUP_BATCH_SIZE,
    });
    if (result.nextContinuationToken) {
      this.orphanContinuationToken = result.nextContinuationToken;
      return;
    }
    this.orphanContinuationToken = undefined;
    this.orphanPrefixIndex =
      (this.orphanPrefixIndex + 1) % ORPHAN_SCAN_PREFIXES.length;
  }
}
