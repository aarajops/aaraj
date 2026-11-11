import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { OrderNotificationsService } from "./order-notifications.service.js";

const POLL_INTERVAL_MS = 10_000;

@Injectable()
export class OrderNotificationsWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OrderNotificationsWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<number> | undefined;
  private stopping = false;

  constructor(private readonly notifications: OrderNotificationsService) {}

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
    this.active = this.notifications.dispatchPending();
    let processed = 0;
    try {
      processed = await this.active;
    } catch {
      this.logger.error(
        "Order notification processing failed; unresolved messages remain visible to operations.",
      );
    } finally {
      this.active = undefined;
      this.schedule(processed > 0 ? 0 : POLL_INTERVAL_MS);
    }
  }
}
