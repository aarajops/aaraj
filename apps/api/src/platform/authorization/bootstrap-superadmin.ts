import { NestFactory } from "@nestjs/core";
import { loadLocalEnvironment } from "../config/local-environment.js";
import { PlatformAuthorizationModule } from "./authorization.module.js";
import { AccessService } from "./access.service.js";

loadLocalEnvironment();
const [userId, reasonFlag, reason, ...extra] = process.argv.slice(2);
if (!userId || reasonFlag !== "--reason" || !reason || extra.length) {
  throw new Error(
    'Usage: pnpm --filter @aaraj/api access:bootstrap <existing-user-id> --reason "Initial owner setup"',
  );
}
const app = await NestFactory.createApplicationContext(
  PlatformAuthorizationModule,
  { logger: ["error"] },
);
try {
  const access = await app
    .get(AccessService)
    .bootstrapSuperadmin(userId, { reason });
  console.log(JSON.stringify(access));
} finally {
  await app.close();
}
