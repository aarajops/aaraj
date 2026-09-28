# NestJS WebSockets Architecture & Engineering Standards

> **Domain**: Full-Duplex Bidirectional Communication, Real-Time Gateways & Adapters  
> **Framework Compatibility**: NestJS v11+ / v12 (`@nestjs/websockets` v11+, `@nestjs/platform-socket.io`, `@nestjs/platform-ws`)  
> **Runtime Target**: Node.js 24 LTS / Pure ECMAScript Modules (ESM) / TypeScript Strict Mode

WebSockets provide persistent, low-latency, bidirectional communication channels over a single TCP connection. In NestJS, real-time communication is abstracted through **Gateways** (`@WebSocketGateway()`), providing a transport-agnostic programming model that shares the same architectural idioms as HTTP controllers: Dependency Injection, Decorators, Exception Filters, Pipes, Guards, and Interceptors.

NestJS supports two primary WebSocket drivers out of the box:
- **Socket.IO** (`@nestjs/platform-socket.io`): A robust, feature-rich library offering namespaces, rooms, multiplexing, automatic fallback to HTTP long-polling, and cross-node broadcasting via Redis adapters.
- **ws** (`@nestjs/platform-ws`): A lightweight, blazing-fast, RFC 6455-compliant native WebSocket implementation optimized for extreme throughput and minimal memory footprint.

```text
                        INCOMING WEBSOCKET CONNECTION / FRAME
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │      Platform Adapter Layer           │
                      │  (IoAdapter / WsAdapter / Custom)     │
                      │  • Port / Path Multiplexing           │
                      │  • Handshake Auth & Connection Hooks  │
                      └───────────────────┬───────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │         Connection Lifecycle          │
                      │  • OnGatewayInit (afterInit)          │
                      │  • OnGatewayConnection                │
                      │  • Request-Scoped Providers (v12)     │
                      └───────────────────┬───────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │    WsGuards (Message Authorization)   │
                      │    (Throws WsException on 403)        │
                      └───────────────────┬───────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │    WsPipes (Standard Schema / Zod)    │
                      │    (Validates & Transforms Payload)   │
                      └───────────────────┬───────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │       WsInterceptors (RxJS AOP)       │
                      │       (Pre-Handler Metrics / Audit)   │
                      └───────────────────┬───────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │          Gateway Event Handler        │
                      │       (@SubscribeMessage('event'))    │
                      │       Returns: ack, WsResponse, Stream│
                      └───────────────────┬───────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │      WsExceptionFilter (Catch)        │
                      │  • Gateway-Scoped Error Formatting    │
                      │  • Cause Attribution to Event Payload │
                      └───────────────────────────────────────┘
```

---

## 1. Adapter Comparison: Socket.IO vs. Native WS

Choosing the appropriate transport driver depends on your client topology, latency demands, and clustering architecture:

| Architectural Dimension | Socket.IO (`@nestjs/platform-socket.io`) | WS (`@nestjs/platform-ws`) |
| :--- | :--- | :--- |
| **Underlying Engine** | [socket.io](https://socket.io/) v4+ | [ws](https://github.com/websockets/ws) v8+ |
| **Protocol Support** | WebSocket, Engine.IO, HTTP Long-Polling fallback | RFC 6455 Pure WebSocket protocol strictly |
| **Namespaces** | Built-in native support (`namespace: 'chat'`) | Not supported (multiplex via distinct `path: '/chat'`) |
| **Rooms / Groups** | Native server-side rooms (`client.join('room-1')`) | Manual implementation via client collections |
| **Acknowledgments** | Built-in request-response ACK callbacks (`@Ack()`) | Manual correlation IDs over message payloads |
| **Clustering & Scaling** | Out-of-the-box Redis adapter (`@socket.io/redis-adapter`) | Requires custom Redis Pub/Sub broadcast layer |
| **Throughput & Memory** | Moderate overhead per socket (~7.5 KB/socket) | Extremely lightweight (<2 KB/socket), ultra-high QPS |
| **Client Ecosystem** | Requires Socket.IO client library (`socket.io-client`) | Standard browser `new WebSocket()` API or any RFC client |

---

## 2. Horizontal Scaling & Clustering Architecture

When deploying multiple instances of a WebSocket gateway behind a load balancer (e.g., Kubernetes Ingress, AWS ALB, Nginx):

```text
                                [ Client A ]          [ Client B ]
                                     │                      │
                                     ▼                      ▼
                           ┌───────────────────────────────────┐
                           │    Load Balancer (Sticky Session)  │
                           └─────────┬───────────────┬─────────┘
                                     │               │
                        ┌────────────┘               └────────────┐
                        ▼                                         ▼
            ┌───────────────────────┐                 ┌───────────────────────┐
            │   NestJS Gateway #1   │                 │   NestJS Gateway #2   │
            │  (Socket.IO / Redis)  │                 │  (Socket.IO / Redis)  │
            └───────────┬───────────┘                 └───────────┬───────────┘
                        │                                         │
                        │        Pub/Sub Broadcast Messages       │
                        └───────────────► ┌───────┐ ◄─────────────┘
                                          │ Redis │
                                          └───────┘
```

1. **Sticky Sessions vs. WebSocket Only**:
   - If using **Socket.IO** with default transports (`polling` + `websocket`), the load balancer **must** enforce cookie-based sticky sessions. Otherwise, initial HTTP handshake requests will route across alternating pods and fail.
   - To eliminate sticky session requirements, force clients and servers to use strictly `transports: ['websocket']`.
2. **Redis Adapter Distribution**:
   - By attaching `@socket.io/redis-adapter`, rooms and broadcast messages (`server.to('room').emit(...)`) are automatically relayed across all horizontally distributed NestJS pods via Redis Pub/Sub channels.

---

## 3. WebSockets Documentation Index

Explore the 6 comprehensive guides covering the complete real-time lifecycle in NestJS:

1. **[01 - Gateways](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/websockets/01-gateways.md)**: `@WebSocketGateway()`, port and namespace bindings, message subscriptions (`@SubscribeMessage`), payload extraction (`@MessageBody`), socket instances (`@ConnectedSocket`), acknowledgments (`@Ack()`), streaming observables (`WsResponse`), lifecycle hooks (`OnGatewayInit`, `OnGatewayConnection`, `OnGatewayDisconnect`), and **NestJS 12 request-scoped connection services** with `REQUEST` token injection.
2. **[02 - Exception Filters](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/websockets/02-exception-filters.md)**: WebSockets exception architecture, `WsException`, error frame structures (`status: 'error'`, `cause`), why global `APP_FILTER` is bypassed, binding gateway-scoped and method-scoped filters with `@UseFilters()`, and custom filters extending `BaseWsExceptionFilter`.
3. **[03 - Pipes](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/websockets/03-pipes.md)**: Data transformation and validation, converting validation errors to `WsException`, `ValidationPipe` with custom `exceptionFactory`, parameter-level pipe binding, and modern Standard Schema V1 / Zod schema validation via `@MessageBody({ schema })` and `StandardSchemaValidationPipe`.
4. **[04 - Guards](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/websockets/04-guards.md)**: WebSocket authorization layer, boolean guards, throwing `WsException`, extracting handshake auth tokens and headers, connection-level authentication in `handleConnection()` vs message-level authorization via `@UseGuards()`.
5. **[05 - Interceptors](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/websockets/05-interceptors.md)**: Aspect-Oriented Programming (AOP) across WebSockets, measuring execution latency, transforming `WsResponse` streams with RxJS operators, and understanding the direct `client.emit()` bypass caveat.
6. **[06 - Adapters](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/websockets/06-adapters.md)**: Transport engine internals, implementing `WebSocketAdapter`, multi-node clustering with `IoAdapter` and Redis, high-throughput native WebSockets with `WsAdapter`, custom `messageParser`, and building bespoke adapters from scratch.

---

## 4. Production Engineering Checklist

- [ ] **Enforce Transport Security (WSS)**: Always terminate TLS at your reverse proxy (e.g., Nginx, Traefik, AWS ALB) and ensure WebSocket connections upgrade to secure `wss://`.
- [ ] **Configure Reverse Proxy Timeouts**: Standard proxies (Nginx `proxy_read_timeout`, Cloudflare) drop idle connections after 60–100 seconds. Configure server/client ping-pong heartbeats (Socket.IO `pingInterval: 25000`, `pingTimeout: 20000`).
- [ ] **Beware of Global Filters**: Global exception filters registered via `app.useGlobalFilters()` or `APP_FILTER` **do not catch WebSocket gateway exceptions**. Always bind filters with `@UseFilters()` at the gateway class level.
- [ ] **Transform Validation Errors to WsException**: The default `ValidationPipe` throws `BadRequestException` (`HttpException`), which NestJS masks as `'Internal server error'` over WebSockets. Configure `exceptionFactory: (errors) => new WsException(errors)`.
- [ ] **Scope Request-Scoped Providers to Connection Lifetime**: In NestJS 12, `Scope.REQUEST` within gateways lives for the duration of the client connection, holding per-connection state. Release event listeners and memory references inside `handleDisconnect()` to prevent memory leaks.
- [ ] **Enable Sticky Sessions or Enforce WebSocket-Only Transport**: When scaling Socket.IO across multiple nodes with Redis, either enable sticky sessions on the load balancer or configure `transports: ['websocket']` on both server and client.
- [ ] **Strict ESM Imports**: Ensure all internal imports use explicit `.js` file extensions in alignment with Node.js 24 and TypeScript `NodeNext` specifications.
