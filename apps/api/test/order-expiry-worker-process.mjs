import { NestFactory } from "@nestjs/core";
import { AppModule } from "../dist/app.module.js";
import { OrderServiceabilityExpiryWorker } from "../dist/orders/order-serviceability-expiry.worker.js";

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});
try {
  const expiredCount = await app.get(OrderServiceabilityExpiryWorker).runOnce();
  process.stdout.write(String(expiredCount));
} finally {
  await app.close();
}
