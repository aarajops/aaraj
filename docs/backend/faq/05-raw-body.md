# Raw Body Buffers & Webhook Signature Verification

> **Domain**: Cryptographic Webhook Security, Payload Integrity & Stream Parsing  
> **Framework Compatibility**: NestJS v11+ / v12  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM)

Many third-party integrations (Stripe, GitHub, Shopify, Slack, Twilio) deliver incoming events via HTTP webhooks protected by HMAC cryptographic signatures.

To compute and verify the signature hash against the secret key, the server **must** calculate the hash over the exact, unparsed raw bytes of the request body. If the JSON payload has already been parsed and re-serialized, minor variations in whitespace or object key order will invalidate the signature.

NestJS provides native `rawBody` support across both Express and Fastify adapters.

---

## 1. Express Implementation (`@nestjs/platform-express`)

### Step 1: Enable `rawBody` in Bootstrap

> **Requirement**: You must retain the built-in body parser. Do not pass `bodyParser: false`.

```typescript
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // Retains raw buffer on request object
  });

  // Optional: Raise body parser limit for large payloads (default is 100kb)
  app.useBodyParser('json', { limit: '10mb' });

  await app.listen(3000);
}
await bootstrap();
```

### Step 2: Accessing `rawBody` in Route Handlers

Type the request object with `RawBodyRequest<Request>` imported from `@nestjs/common`:

```typescript
import {
  Controller,
  Post,
  Headers,
  Req,
  BadRequestException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import * as crypto from 'node:crypto';

@Controller('webhooks')
export class WebhooksController {
  private readonly webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test';

  @Post('stripe')
  handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    const rawPayload: Buffer | undefined = req.rawBody;

    if (!rawPayload) {
      throw new BadRequestException('Raw request body missing');
    }

    // Verify HMAC signature
    const hmac = crypto.createHmac('sha256', this.webhookSecret);
    hmac.update(rawPayload);
    const expectedSignature = hmac.digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );

    if (!isValid) {
      throw new BadRequestException('Invalid webhook signature');
    }

    // Both rawBody (Buffer) and parsed body (object) remain available
    const parsedPayload = req.body;
    return { received: true, event: parsedPayload.type };
  }
}
```

---

## 2. Fastify Implementation (`@nestjs/platform-fastify`)

### Step 1: Enable `rawBody` in Bootstrap

```typescript
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    {
      rawBody: true,
    },
  );

  // Optional: Customize Fastify body limit (default is 1 MiB)
  app.useBodyParser('application/json', {
    bodyLimit: 10 * 1024 * 1024, // 10 MiB
  });

  await app.listen(3000, '0.0.0.0');
}
await bootstrap();
```

### Step 2: Accessing `rawBody` in Fastify Controllers

```typescript
import {
  Controller,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

@Controller('webhooks')
export class FastifyWebhooksController {
  @Post('github')
  handleGithubWebhook(@Req() req: RawBodyRequest<FastifyRequest>) {
    const rawBuffer = req.rawBody; // Returns Buffer
    console.log(`Received raw payload of size: ${rawBuffer?.length} bytes`);
    return { ok: true };
  }
}
```

---

## 3. Registering Additional Content Parsers

By default, NestJS registers only JSON and URL-encoded body parsers. If your webhooks transmit plain text or XML, register them explicitly via `useBodyParser`:

```typescript
// Express
app.useBodyParser('text');

// Fastify
app.useBodyParser('text/plain');
```
