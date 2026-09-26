# Microservices: Custom Transporters

> **Source**: https://docs.nestjs.com/microservices/custom-transport  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/microservices`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

Nest provides an extensible transport strategy API allowing developers to author custom drivers for messaging brokers not supported natively (e.g., Google Cloud Pub/Sub, AWS SQS/SNS, Amazon Kinesis, Azure Service Bus, ZeroMQ) or extend existing drivers with proprietary framing protocols.

---

## 1. Creating a Custom Server Strategy

A custom transporter server must implement the `CustomTransportStrategy` interface and extend the core `Server` class from `@nestjs/microservices`:

```typescript
// src/common/transporters/google-pubsub.server.ts
import { CustomTransportStrategy, Server } from '@nestjs/microservices';
import { isObservable, Observable } from 'rxjs';
import { Logger } from '@nestjs/common';

export class GoogleCloudPubSubServer
  extends Server
  implements CustomTransportStrategy
{
  protected readonly logger = new Logger(GoogleCloudPubSubServer.name);

  /**
   * If the underlying client library reports handler failures,
   * set this to true to prevent Nest from logging duplicate errors.
   */
  public override readonly propagatesEventHandlerErrors = true;

  /**
   * Invoked when app.listen() or app.startAllMicroservices() executes.
   */
  async listen(callback: () => void): Promise<void> {
    this.logger.log('Binding Google Cloud Pub/Sub message subscriptions...');

    // In production, connect to PubSub client and register listeners:
    // this.pubsubClient.subscription('sub-name').on('message', (msg) => this.handleMessage(msg));

    callback();
  }

  /**
   * Invoked during graceful application shutdown.
   */
  async close(): Promise<void> {
    this.logger.log('Closing Pub/Sub subscription consumers...');
    // await this.pubsubClient.close();
  }

  /**
   * Dispatch raw incoming broker messages to Nest's pattern handlers.
   */
  public async handleBrokerMessage(pattern: string, rawPayload: unknown): Promise<unknown> {
    // Lookup registered @MessagePattern or @EventPattern handler
    const handler = this.messageHandlers.get(pattern);

    if (!handler) {
      this.logger.warn(`No handler registered for message pattern: ${pattern}`);
      return;
    }

    // Handlers wrapped in interceptors return RxJS Observables
    const streamOrResult = await handler(rawPayload);

    if (isObservable(streamOrResult)) {
      return new Promise((resolve, reject) => {
        streamOrResult.subscribe({
          next: (value) => resolve(value),
          error: (err) => reject(err),
        });
      });
    }

    return streamOrResult;
  }
}
```

### 1.1 Bootstrapping with Custom Strategy

Pass the custom server strategy via the `strategy` property in `createMicroservice()`:

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { GoogleCloudPubSubServer } from './common/transporters/google-pubsub.server.js';

async function bootstrap() {
  const app = await NestFactory.createMicroservice(AppModule, {
    strategy: new GoogleCloudPubSubServer(),
  });

  await app.listen();
}
void bootstrap();
```

---

## 2. Creating a Custom Client Proxy

To enable producer services to dispatch messages and events through your custom transporter, extend the `ClientProxy` class:

```typescript
// src/common/transporters/google-pubsub.client.ts
import { ClientProxy, ReadPacket, WritePacket } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';

export class GoogleCloudPubSubClient extends ClientProxy {
  protected readonly logger = new Logger(GoogleCloudPubSubClient.name);

  async connect(): Promise<void> {
    this.logger.log('Connecting client to Google Cloud Pub/Sub...');
  }

  async close(): Promise<void> {
    this.logger.log('Closing Pub/Sub client connection...');
  }

  /**
   * Handles Event-Driven Messaging (@EventPattern / client.emit())
   */
  protected async dispatchEvent(packet: ReadPacket<any>): Promise<void> {
    this.logger.log(`Publishing event [${packet.pattern}]: ${JSON.stringify(packet.data)}`);
    // await this.topic.publishJSON(packet.data);
  }

  /**
   * Handles Request-Response Messaging (@MessagePattern / client.send())
   */
  protected publish(
    packet: ReadPacket<any>,
    callback: (packet: WritePacket<any>) => void,
  ): () => void {
    this.logger.log(`Publishing request [${packet.pattern}] with correlationId`);

    // Simulate asynchronous broker reply:
    const timer = setTimeout(() => {
      callback({
        response: { success: true, echoed: packet.data },
        isDisposed: true, // Signals Observable completion
      });
    }, 100);

    // Teardown / cancellation function (triggered if caller applies timeout())
    return () => {
      clearTimeout(timer);
      this.logger.log(`Request [${packet.pattern}] cancelled by caller`);
    };
  }
}
```

---

## 3. Custom Error Serialization

To customize how errors are serialized over the wire across all calls made by a client proxy, extend `ClientProxy` and override `serializeError()`:

```typescript
// src/common/transporters/error-handling-proxy.ts
import { ClientTCP, RpcException } from '@nestjs/microservices';

export class ErrorHandlingProxy extends ClientTCP {
  override serializeError(err: Error): RpcException {
    return new RpcException({
      code: 'REMOTE_CALL_FAILED',
      message: err.message,
      timestamp: new Date().toISOString(),
    });
  }
}
```

Register the custom class token with `ClientsModule.register()`:

```typescript
@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'CUSTOM_TCP_SERVICE',
        customClass: ErrorHandlingProxy,
        options: { host: '127.0.0.1', port: 8877 },
      },
    ]),
  ],
})
export class CommonModule {}
```
