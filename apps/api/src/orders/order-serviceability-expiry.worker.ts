import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { OrdersService } from "./orders.service.js";

const EXPIRY_POLL_INTERVAL_MS = 30_000;
const EXPIRY_BATCH_SIZE = 50;

@Injectable()
export class OrderServiceabilityExpiryWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OrderServiceabilityExpiryWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private activeRun: Promise<number> | undefined;
  private stopping = false;

  constructor(private readonly orders: OrdersService) {}

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
    this.activeRun = this.orders
      .expirePendingServiceabilityReviews(EXPIRY_BATCH_SIZE)
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
      this.logger.error("Order serviceability expiry batch failed.");
    } finally {
      this.schedule(count === EXPIRY_BATCH_SIZE ? 0 : EXPIRY_POLL_INTERVAL_MS);
    }
  }
}
