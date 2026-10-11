import { NestFactory } from "@nestjs/core";
import { AppModule } from "../dist/app.module.js";
import { PathaoService } from "../dist/delivery/pathao/pathao.service.js";

const [merchantOrderId, orderStatus] = process.argv.slice(2);
if (!merchantOrderId || !orderStatus) {
  throw new Error(
    "Pathao recovery process requires provider verification data.",
  );
}

globalThis.fetch = async (input) => {
  const requestUrl = input instanceof Request ? input.url : input.toString();
  const url = new URL(requestUrl);
  if (url.pathname.endsWith("/issue-token")) {
    return new Response(
      JSON.stringify({
        token_type: "Bearer",
        expires_in: 3600,
        access_token: "restart-test-access",
        refresh_token: "restart-test-refresh",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.pathname.includes("/orders/") && url.pathname.endsWith("/info")) {
    const consignmentId = decodeURIComponent(url.pathname.split("/").at(-2));
    return new Response(
      JSON.stringify({
        data: {
          consignment_id: consignmentId,
          merchant_order_id: merchantOrderId,
          order_status_slug: orderStatus,
          updated_at: "2026-10-10T05:00:00Z",
          invoice_id: null,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response("{}", {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
};

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});
try {
  const pathao = app.get(PathaoService);
  const expiredBookings = await pathao.expireInterruptedBookings();
  const processedWebhooks = await pathao.processPendingWebhooks();
  process.stdout.write(JSON.stringify({ expiredBookings, processedWebhooks }));
} finally {
  await app.close();
}
