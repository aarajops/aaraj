# 04 - Logging

> **Source:** [NestJS official logger documentation](https://docs.nestjs.com/application/logger)

## Use NestJS's built-in logger

NestJS provides `Logger` and `ConsoleLogger` from `@nestjs/common`. For Aaraj's NestJS 12 API, the built-in logger supports JSON output and structured parameters, so no logging package is needed for the current requirements.

Configure the application logger in the existing `NestFactory.create()` call. Keep Aaraj's `bodyParser: false` setting, which is required by the Better Auth integration:

```typescript
import { ConsoleLogger } from '@nestjs/common';

const isProduction = process.env.NODE_ENV === 'production';

const app = await NestFactory.create(AppModule, {
  bodyParser: false,
  logger: new ConsoleLogger({
    json: isProduction,
    logLevels: isProduction
      ? ['log', 'warn', 'error', 'fatal']
      : ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'],
  }),
});
```

In production, `ConsoleLogger` writes one JSON record per line to stdout or stderr for the container runtime or log collector. Each record includes fields such as `level`, `timestamp`, `message`, and `context`. In NestJS 12, plain objects passed after the message are structured parameters and, by default, appear under `params`:

```typescript
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  complete(orderId: string) {
    this.logger.log('Order completed', { orderId });
  }
}
```

Nest also supports `flattenParams: true` to place those fields at the JSON record's top level. Keep the default nesting unless the selected log collector requires flattened fields.

Use the service class name as the logger context. Include only fields needed to diagnose the event. Never log passwords, authorization headers, cookies, session tokens, or raw authentication request bodies.

## Authentication events and audit history

Better Auth's `after` hook records the outcome of email sign-up, email sign-in, and sign-out through Nest's logger. These operational security logs contain the event name, outcome, and user ID when Better Auth provides one. They deliberately omit email addresses, IP addresses, user agents, request bodies, credentials, and session data.

Operational logs are not durable business audit history. Aaraj's reusable audit writer and append-only PostgreSQL event table live under `apps/api/src/platform/audit/`; the first staff permission grant or revocation is only its first use, not a staff-only audit system. Domain modules call the same writer for auditable operations across identity and access, catalog and pricing, inventory, orders and payments, fulfillment, support, and moderation.

Record consequential business and security changes, including staff access changes, manual inventory adjustments, order/payment/refund decisions, and sensitive support or moderation actions. Record sensitive reads or exports when the approved policy requires it. Do not turn ordinary browsing or every routine read into audit events. Each record should identify the actor, action, affected subject, timestamp, and request/correlation identifier when available; include a reason for privileged manual actions. Omit credentials, tokens, and full row snapshots.

Write the audit record in the same PostgreSQL transaction as the state change it describes by passing that Drizzle transaction to `AuditService.append()`. Keep the shared audit store append-only at the application layer and restrict access. Domain modules should use the shared audit capability without directly depending on another domain's tables. Add coverage with each auditable mutation; do not create separate per-domain audit tables.

Do not add a separate logging package, event bus, hash chain, or WORM storage for the initial slice. Reassess retention, tamper-evidence, and external archival when deployment and compliance requirements are known.

## When to use an external logger

Nest's documentation recommends considering Pino or Winston when an application needs in-process file or network transports, field redaction, custom serializers, or very high logging throughput. Aaraj does not currently have those requirements; keep the built-in logger unless one arises. Nest supports custom implementations through `LoggerService` and also documents community integrations.

Operational logs are for runtime diagnosis. They do not replace durable business audit history, which must be stored as database records alongside the business changes it describes.
