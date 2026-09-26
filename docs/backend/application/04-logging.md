# 04 - Logging

> **Source Reference**: [NestJS Official Documentation - Logger](https://docs.nestjs.com/application/logger)

Observability in modern cloud-native environments (Docker, Kubernetes, AWS ECS, Google Cloud Run) depends on structured, machine-readable logs emitted to `stdout` and `stderr`. External container log collectors (Datadog, AWS CloudWatch, Grafana Loki, Fluent Bit) ingest these streams directly.

NestJS provides a built-in logging system centered around the `Logger` and `ConsoleLogger` classes in `@nestjs/common`.

---

## 1. Production Configuration: Structured JSON Logging

Starting with NestJS 12, the built-in `ConsoleLogger` natively supports production-grade JSON formatting and structured parameters without requiring external logging dependencies (like Winston or Pino).

### Configuring JSON Output in `main.ts`

```typescript
// apps/api/src/main.ts
import { NestFactory } from '@nestjs/core';
import { ConsoleLogger } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create(AppModule, {
    // Buffer logs during bootstrap until custom logger is attached
    bufferLogs: true,
    logger: isProd
      ? new ConsoleLogger({
          json: true,              // Machine-readable single-line JSON
          flattenParams: true,     // Spread metadata into root of JSON
          logLevels: ['log', 'warn', 'error', 'fatal'], // Filter debug/verbose
        })
      : new ConsoleLogger({
          colors: true,            // Human-readable colorized text in local dev
        }),
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

### Log Output Format Comparison

#### Local Development Mode (`colors: true, json: false`):
```text
[Nest] 12570  - 09/26/2026, 9:15:57 AM     LOG [OrdersService] Order processed { orderId: "ord_102", amount: 49.99 }
```

#### Production Mode (`json: true, flattenParams: true`):
```json
{"level":"log","pid":12570,"timestamp":1790435757000,"message":"Order processed","context":"OrdersService","orderId":"ord_102","amount":49.99}
```

---

## 2. Structured Logging Params (NestJS 12)

In NestJS 12, any plain JavaScript object passed after the log message is treated as a **structured param** and attached directly to that log event rather than emitted as a separate line:

```typescript
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  async processPayment(orderId: string, amount: number, userId: string) {
    this.logger.log('Payment initiated', {
      orderId,
      amount,
      userId,
      attempt: 1,
    });
  }
}
```

### Formatting Options:

| Setting | Default | Description |
| :--- | :--- | :--- |
| `structuredParams` | `true` | When true, plain objects after the message string become params. |
| `flattenParams` | `false` | When true, params are spread directly into the root of the JSON log object rather than nested under `"params": {...}`. Highly recommended for Datadog and BigQuery aggregators. |

---

## 3. Log Levels & Cascading

Log levels cascade in order of severity. Enabling a lower severity level automatically enables all higher severity levels:
1. `verbose` (lowest)
2. `debug`
3. `log`
4. `warn`
5. `error`
6. `fatal` (highest)

```typescript
new ConsoleLogger({
  logLevels: ['log', 'warn', 'error', 'fatal'], // debug and verbose are silenced
});
```

---

## 4. Service-Level Logging Best Practices

Instantiate a `Logger` in each service constructor with `Context` set to the class name:

```typescript
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class UsersService {
  // Providing the class name as context automatically populates the "context" field
  private readonly logger = new Logger(UsersService.name);

  async createUser(email: string) {
    this.logger.log('Creating new user', { email });

    try {
      // business logic...
    } catch (error) {
      this.logger.error(
        'Failed to create user',
        error instanceof Error ? error.stack : undefined,
        { email },
      );
      throw error;
    }
  }
}
```

---

## 5. Dependency-Injected Custom Logger with Scopes

When a logger needs dependency injection (e.g. injecting `ConfigService` to configure output destinations or log levels):

### Transient Scope Requirement
To ensure that calling `logger.setContext('ServiceName')` does not overwrite the context of other services sharing the logger, declare the logger with `Scope.TRANSIENT`:

```typescript
// src/common/logger/app-logger.service.ts
import { Injectable, Scope, ConsoleLogger } from '@nestjs/common';

@Injectable({ scope: Scope.TRANSIENT })
export class AppLogger extends ConsoleLogger {
  audit(action: string, metadata: Record<string, unknown>) {
    this.log(`AUDIT: ${action}`, metadata);
  }
}
```

```typescript
// src/common/logger/logger.module.ts
import { Module } from '@nestjs/common';
import { AppLogger } from './app-logger.service.js';

@Module({
  providers: [AppLogger],
  exports: [AppLogger],
})
export class LoggerModule {}
```

```typescript
// Service consumption:
@Injectable()
export class AuthService {
  constructor(private readonly logger: AppLogger) {
    // Transient scope guarantees AuthService receives its own dedicated AppLogger instance:
    this.logger.setContext(AuthService.name);
  }

  login(user: string) {
    this.logger.audit('User logged in', { user });
  }
}
```

---

## 6. Request Correlation & Distributed Tracing

In microservices and high-throughput web apps, isolated log lines are difficult to trace across service calls. Every log line emitted during a request should carry a `traceId`.

Using Node's `AsyncLocalStorage` or [NestJS Observe](https://observe.nestjs.com), the logger automatically associates the current request's trace ID with every log statement emitted within that asynchronous context:

```json
{
  "level": "error",
  "pid": 12570,
  "timestamp": 1790435757000,
  "message": "Transaction failed",
  "context": "PaymentService",
  "orderId": "ord_9901",
  "traceId": "0199a3f2-7c1e-7b40-9d2a-5e8f1c3b7a64"
}
```

Engineers can query their aggregator (e.g. `traceId: 0199a3f2-7c1e-7b40-9d2a-5e8f1c3b7a64`) to see the complete timeline of database queries, HTTP calls, and log entries from that single user action.

---

## 7. When to Use External Loggers (Pino / Winston)

The built-in NestJS `ConsoleLogger` covers 95% of production use cases because Kubernetes and Docker natively stream `stdout` to collectors. Reach for Pino or Winston only when you need:
1. Direct in-process network/file transports (e.g. sending logs over TCP/Syslog directly from Node.js instead of stdout).
2. Automated in-memory field redaction for strict HIPAA/PCI-DSS compliance before writing to stdout.
3. Microsecond-sensitive logging throughput in ultra-high-volume services.
