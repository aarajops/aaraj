import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { QuoteService } from "./quote.service.js";

const CLEANUP_POLL_INTERVAL_MS = 15 * 60_000;
const CLEANUP_BATCH_SIZE = 500;

@Injectable()
export class QuoteSnapshotCleanupWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(QuoteSnapshotCleanupWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private activeRun: Promise<number> | undefined;
  private stopping = false;

  constructor(private readonly quotes: QuoteService) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === "test") return;
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.activeRun?.catch(() => undefined);
  }

  runOnce(): Promise<number> {
    if (this.activeRun) return this.activeRun;
    this.activeRun = this.quotes
      .pruneExpiredUnreferenced(CLEANUP_BATCH_SIZE)
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
    try {
      count = await this.runOnce();
    } catch {
      this.logger.error("Expired quote snapshot cleanup failed.");
    } finally {
      this.schedule(
        count === CLEANUP_BATCH_SIZE ? 0 : CLEANUP_POLL_INTERVAL_MS,
      );
    }
  }
}
