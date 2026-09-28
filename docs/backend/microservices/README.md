# NestJS Microservices Architecture & Transporters

> **Domain**: Distributed Systems, Message Brokers, Event-Driven Architecture & RPC  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/microservices`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

In addition to traditional HTTP monolithic applications and real-time WebSockets, NestJS provides first-class native support for the **Microservice architectural style**.

In Nest, a microservice is fundamentally an application that swaps the HTTP transport layer for an asynchronous message broker, a high-throughput binary protocol, or an RPC communication channel. Nest abstracts transporter-specific wire protocols behind a canonical, transport-agnostic interface supporting two messaging paradigms:
1. **Request-Response Messaging** (`@MessagePattern()` & `ClientProxy.send()`): Two-way synchronous-like RPC exchange with correlation tracking and response acknowledgment.
2. **Event-Driven Messaging** (`@EventPattern()` & `ClientProxy.emit()`): One-way fire-and-forget publish/subscribe messaging for asynchronous notification and fan-out distribution.

```text
                                DISTRIBUTED INGRESS
                       (TCP / Redis / MQTT / NATS / RMQ / Kafka / gRPC)
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │          Transport Adapter            │
                     │  (ServerTCP / ServerKafka / ServerRMQ)│
                     │  • Frame Parsing & Deserialization    │
                     │  • Pattern Matching (String/Object/Rx)│
                     └───────────────────┬───────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │          Pre-Request Hooks            │
                     │  (AsyncLocalStorage / Correlation ID) │
                     └───────────────────┬───────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │       Microservice Enhancers          │
                     │  • Guards (Throws RpcException)       │
                     │  • Interceptors (Pre-Handler Stream)  │
                     │  • Pipes (Payload Schema Validation)  │
                     └───────────────────┬───────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │          Pattern Handler              │
                     │  • @MessagePattern() -> Returns Data  │
                     │  • @EventPattern()   -> Fire & Forget │
                     └───────────────────┬───────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │         RpcExceptionFilter            │
                     │  • Translates Errors to Wire Formats  │
                     │  • GrpcExceptionFilter / Kafka Retries│
                     └───────────────────────────────────────┘
```

---

## 1. Transporter Architectural Matrix

NestJS includes 7 battle-tested transporters out of the box, in addition to supporting bespoke custom transport strategies:

| Transporter | Protocol / Driver | Paradigm | Delivery Guarantee | Best Use Cases |
| :--- | :--- | :--- | :--- | :--- |
| **TCP** | Node.js `net` / TLS | Request-Response & Events | At-least-once (Stream) | Internal low-overhead point-to-point service communication. |
| **Redis** | `ioredis` (Pub/Sub) | Event-Driven & Request-Response | At-most-once (Fire-and-forget) | Ephemeral broadcasting, notifications, cache invalidation. |
| **MQTT** | `mqtt` | Event-Driven (Pub/Sub) | QoS 0, QoS 1, QoS 2 | IoT devices, telemetry, constrained low-bandwidth networks. |
| **NATS** | `@nats-io/transport-node` (NATS v3) | Request-Response & Event Fan-out | At-most-once / At-least-once | High-performance cloud-native microservices, queue groups. |
| **RabbitMQ** | `amqplib` / AMQP 0-9-1 | Queues & Exchanges | At-least-once (Manual Acks) | Complex routing keys, reliable task queues, enterprise transactional workflows. |
| **Kafka** | `kafkajs` | Log-based Event Streaming | At-least-once (Committed Offsets) | Big data streaming, event sourcing, durable audit logs, high throughput. |
| **gRPC** | `@grpc/grpc-js` (HTTP/2 + Protobuf) | Synchronous RPC & Bidirectional Streaming | At-least-once / Strict RPC | Strongly-typed polyglot contracts, internal low-latency APIs, service meshes. |

---

## 2. Hybrid Application Topology

A single NestJS application can simultaneously expose an HTTP REST API, a GraphQL supergraph, WebSockets gateways, and connect to one or more microservice message brokers:

```text
                           ┌───────────────────────────┐
                           │      Hybrid Nest App      │
                           │   (AppModule / main.ts)   │
                           └─────────────┬─────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              ▼                          ▼                          ▼
    ┌───────────────────┐      ┌───────────────────┐      ┌───────────────────┐
    │ HTTP Web Server   │      │ Microservice #1   │      │ Microservice #2   │
    │ (Fastify :3000)   │      │ (RabbitMQ RMQ)    │      │ (Kafka Consumer)  │
    └───────────────────┘      └───────────────────┘      └───────────────────┘
```

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // 1. Instantiate Primary HTTP Application
  const app = await NestFactory.create(AppModule);

  // 2. Attach RabbitMQ Microservice Consumer
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
      queue: 'orders_queue',
      noAck: false,
    },
  });

  // 3. Attach NATS Microservice Consumer
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.NATS,
    options: {
      servers: [process.env.NATS_URL || 'nats://localhost:4222'],
      queue: 'orders_nats_group',
    },
  });

  // 4. Start all connected microservices and then listen on HTTP port
  await app.startAllMicroservices();
  await app.listen(3000);
}
void bootstrap();
```

---

## 3. Microservices Documentation Index

Explore the 13 comprehensive guides covering every layer of the NestJS microservices ecosystem:

1. **[01 - Overview & Foundations](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/microservices/01-overview.md)**: `createMicroservice()`, TCP transporter, `@MessagePattern()`, `@EventPattern()`, `@Payload()`, `@Ctx()`, `ClientProxy` (`send()` vs `emit()`), lazy connections, request-scoping with `CONTEXT`, instance status streams, driver `unwrap()`, timeouts, TLS, and dynamic async config.
2. **[02 - Redis Transporter](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/microservices/02-redis.md)**: Pub/Sub engine, fire-and-forget mechanics, `RedisContext`, channel wildcards (`psubscribe`), `RedisStatus` streams, dual-connection unwrap (`[pub, sub]`), and ioredis tuning.
3. **[03 - MQTT Transporter](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/microservices/03-mqtt.md)**: IoT protocol, topic hierarchies (`+` and `#` wildcards), Quality of Service (QoS 0/1/2), `MqttRecordBuilder`, user properties, and `MqttContext`.
4. **[04 - NATS Transporter](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/microservices/04-nats.md)**: High-performance cloud messaging, NATS v3 `@nats-io/transport-node` driver, distributed queue groups, reply subjects, `NatsRecordBuilder`, and JSON message deserialization.
5. **[05 - RabbitMQ Transporter](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/microservices/05-rabbitmq.md)**: AMQP messaging, queues, exchanges (`direct`, `topic`, `fanout`), manual acknowledgements (`noAck: false`, `channel.ack()`), `RmqRecordBuilder`, and routing key wildcards (`*`, `#`).
6. **[06 - Kafka Transporter](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/microservices/06-kafka.md)**: Distributed streaming, `ClientKafkaProxy`, reply partitions & assigners, **NestJS 12 RegExp patterns** (`/^hero\..+$/`), `subscribeToResponseOf()`, keyed messages, manual offset commits, and `KafkaRetriableException` retry filters.
7. **[07 - gRPC Transporter](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/microservices/07-grpc.md)**: Protobuf service definitions, `@GrpcMethod()`, `ClientGrpc`, metadata propagation, **NestJS 12 status-specific gRPC exceptions** (`GrpcExceptionFilter`), gRPC reflection, health checks, and full-duplex streaming (`@GrpcStreamMethod()`, `@GrpcStreamCall()`).
8. **[08 - Custom Transporters](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/microservices/08-custom-transporters.md)**: Implementing `CustomTransportStrategy`, extending `Server`, accessing `messageHandlers`, `propagatesEventHandlerErrors`, authoring custom `ClientProxy`, message serialization, and custom client proxies.
9. **[09 - Exception Filters](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/microservices/09-exception-filters.md)**: `RpcException`, observable error streams, `BaseRpcExceptionFilter`, event handler error boundaries, and hybrid app config inheritance (`inheritAppConfig`).
10. **[10 - Pipes](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/microservices/10-pipes.md)**: Data transformation and validation, mapping validation errors to `RpcException`, and Standard Schema V1 / Zod validation in `@Payload({ schema })`.
11. **[11 - Pre-Request Hooks](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/microservices/11-pre-request-hooks.md)**: `PreRequestHook` middleware equivalent, pipeline execution order, `AsyncLocalStorage` correlation ID propagation, execution timing, and global registration.
12. **[12 - Guards](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/microservices/12-guards.md)**: Microservice authorization, `RpcException('Forbidden resource')`, extracting RPC context (`context.switchToRpc()`), and token verification.
13. **[13 - Interceptors](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/microservices/13-interceptors.md)**: Aspect-Oriented Programming (AOP), transforming response streams, execution metrics, and circuit-breaker integration.

---

## 4. Production Engineering Checklist

- [ ] **Configure Message Timeouts**: Network partitions and downstream crashes cause unbounded latency. Always apply RxJS `timeout(ms)` to `client.send()` calls.
- [ ] **Enforce Manual Acknowledgments on Critical Queues**: When using RabbitMQ, set `noAck: false` and explicitly invoke `channel.ack(msg)` only after state changes have durably committed.
- [ ] **Size Kafka Reply Partitions Appropriately**: When using request-response over Kafka, ensure the reply topic contains at least as many partitions as concurrent Nest instances.
- [ ] **Propagate Correlation IDs with Pre-Request Hooks**: Register a `PreRequestHook` in `main.ts` that initializes an `AsyncLocalStorage` store with an incoming correlation ID before guards and handlers execute.
- [ ] **Inherit App Config in Hybrid Applications**: When using `connectMicroservice()` on a hybrid application, set `inheritAppConfig: true` if you expect HTTP global pipes and guards to apply to microservices.
- [ ] **Transform Validation Errors to RpcException**: Default `ValidationPipe` throws `BadRequestException` (`HttpException`), which NestJS masks as `'Internal server error'` over microservice transports. Always specify `exceptionFactory: (errors) => new RpcException(errors)`.
- [ ] **Strict ESM Imports**: Ensure all relative imports use explicit `.js` extensions for Node.js 24 and TypeScript `NodeNext` compliance.
