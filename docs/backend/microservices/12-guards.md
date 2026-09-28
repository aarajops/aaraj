# Microservices: Guards

> **Source**: https://docs.nestjs.com/microservices/guards  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/microservices`, `@nestjs/common`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

[Guards](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/overview/08-guards.md) in microservices enforce authorization, verify inter-service authentication tokens, and inspect packet metadata before a message or event pattern handler executes.

The core mechanics match HTTP guards, with two transport-specific behaviors:
- **Exception Type**: Guards should throw `RpcException` rather than `HttpException`.
- **False Return Semantics**: When a guard returns `false`, Nest automatically throws an `RpcException` with the message `'Forbidden resource'`.

---

## 1. Accessing RPC Execution Context

Inside `canActivate()`, extract microservice parameters using `context.switchToRpc()`:

```typescript
// src/common/guards/service-auth.guard.ts
import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

@Injectable()
export class ServiceAuthGuard implements CanActivate {
  private readonly logger = new Logger(ServiceAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const rpcContext = context.switchToRpc();
    const data = rpcContext.getData<Record<string, unknown>>();
    const rawContext = rpcContext.getContext<any>();

    // Inspect transporter-specific context headers (e.g. NATS, Kafka, RabbitMQ)
    let serviceKey: string | undefined = undefined;

    if (rawContext && typeof rawContext.getHeaders === 'function') {
      serviceKey = rawContext.getHeaders()?.['x-service-key'];
    } else if (rawContext && typeof rawContext.getMessage === 'function') {
      // RabbitMQ properties
      serviceKey = rawContext.getMessage()?.properties?.headers?.['x-service-key'];
    }

    if (!serviceKey || serviceKey !== process.env.INTERNAL_SERVICE_KEY) {
      this.logger.warn('Rejected unauthorized microservice invocation');
      throw new RpcException({
        code: 'UNAUTHORIZED_SERVICE_CALL',
        message: 'Missing or invalid inter-service authentication key',
      });
    }

    return true;
  }
}
```

---

## 2. Binding Scopes

Guards can be applied at the handler or controller level:

```typescript
// src/billing/billing.controller.ts
import { Controller, UseGuards } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ServiceAuthGuard } from '../common/guards/service-auth.guard.js';

@UseGuards(ServiceAuthGuard)
@Controller()
export class BillingController {
  @MessagePattern('billing.charge')
  chargeCustomer(@Payload() paymentData: unknown) {
    return { status: 'processed' };
  }
}
```

> [!NOTE]
> In hybrid applications, global guards registered via `app.useGlobalGuards()` do not apply to microservices unless `inheritAppConfig: true` is passed to `app.connectMicroservice()`.
