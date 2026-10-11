import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { PathaoService } from "./pathao.service.js";

const PATHAO_WEBHOOK_POLL_INTERVAL_MS = 30_000;

@Injectable()
export class PathaoWebhookWorker
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PathaoWebhookWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly pathao: PathaoService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(
      () => void this.process(),
      PATHAO_WEBHOOK_POLL_INTERVAL_MS,
    );
    this.timer.unref();
    void this.process();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async process(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.pathao.expireInterruptedBookings();
      await this.pathao.processPendingWebhooks();
    } catch {
      this.logger.warn("Pathao webhook observations will be retried.");
    } finally {
      this.running = false;
    }
  }
}
