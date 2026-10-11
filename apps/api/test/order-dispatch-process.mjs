import { NestFactory } from "@nestjs/core";
import { AppModule } from "../dist/app.module.js";
import { OrdersService } from "../dist/orders/orders.service.js";

const [orderId, staffId, commandId, encodedInput] = process.argv.slice(2);
if (!orderId || !staffId || !commandId || !encodedInput) {
  throw new Error("Order dispatch process requires its durable command input.");
}

const input = JSON.parse(Buffer.from(encodedInput, "base64url").toString());
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});
try {
  const order = await app
    .get(OrdersService)
    .dispatch(orderId, staffId, commandId, input);
  process.stdout.write(
    JSON.stringify({
      id: order.id,
      fulfillmentStatus: order.fulfillmentStatus,
      dispatch: order.dispatch,
    }),
  );
} finally {
  await app.close();
}
