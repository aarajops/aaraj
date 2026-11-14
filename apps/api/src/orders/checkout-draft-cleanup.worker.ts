import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { CheckoutDraftsService } from "./checkout-drafts.service.js";

const POLL_INTERVAL_MS = 15 * 60_000;
const BATCH_SIZE = 500;

@Injectable()
export class CheckoutDraftCleanupWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(CheckoutDraftCleanupWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<number> | undefined;
  private stopping = false;

  constructor(private readonly drafts: CheckoutDraftsService) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV !== "test") this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active?.catch(() => undefined);
  }

  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => void this.run(), delay);
    this.timer.unref();
  }

  private async run(): Promise<void> {
    if (this.active) return;
    this.active = this.drafts.cleanup(BATCH_SIZE);
    let count = 0;
    let failed = false;
    try {
      count = await this.active;
    } catch {
      failed = true;
      this.logger.error("Checkout draft cleanup failed.");
    } finally {
      this.active = undefined;
      this.schedule(
        failed ? 60_000 : count === BATCH_SIZE ? 0 : POLL_INTERVAL_MS,
      );
    }
  }
}
