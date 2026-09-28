# NestJS HTTP Protocol & Web Platform Reference

> **Source Reference**: [NestJS Official Documentation - HTTP](https://docs.nestjs.com/http/versioning)

NestJS provides a versatile abstraction layer over Node.js HTTP servers, supporting both **Express** (the battle-tested default) and **Fastify** (the ultra-high-throughput alternative). The **HTTP** tier covers web-specific capabilities: API versioning strategies, native cookie parsing and secret rotation, session management, file upload streams, payload compression, Server-Sent Events (SSE), server-rendered MVC views, and Fastify performance tuning.

---

## HTTP Tier Table of Contents

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Versioning](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/http/01-versioning.md) | URI, Header, Media Type (`Accept`), Custom extractors, `@Version()`, `VERSION_NEUTRAL`, default versions |
| **02** | [Cookies](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/http/02-cookies.md) | Native NestJS 12.1+ cookie API, `@Cookies()`, `@SignedCookies()`, `setCookie()`, secret rotation, `SameSite` |
| **03** | [Session](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/http/03-session.md) | `express-session`, `@fastify/secure-session`, `@Session()`, cookie signing, distributed session storage |
| **04** | [File Upload & Streaming](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/http/04-file-upload-streaming.md) | Multipart uploads, `FileInterceptor`, `ParseFilePipe`, Fastify streaming (`FileStreamInterceptor`), `StreamableFile` |
| **05** | [Compression](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/http/05-compression.md) | `compression` (Express), `@fastify/compress` (Brotli/Gzip), quality tuning, reverse proxy offloading |
| **06** | [Server-Sent Events (SSE)](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/http/06-server-sent-events.md) | `@Sse()`, `Observable<MessageEvent>`, `EventSource` protocol, client disconnection, `@SseSignal()` cleanup |
| **07** | [Model-View-Controller (MVC)](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/http/07-mvc.md) | Server-side templating with Handlebars (`hbs`), layouts, static assets (`useStaticAssets`), `@Render()` |
| **08** | [Performance (Fastify)](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/http/08-performance-fastify.md) | `FastifyAdapter`, extreme throughput, low overhead, body limits, route routing differences |

---

## Express vs. Fastify Adapter Comparison

| Feature | Express (`@nestjs/platform-express`) | Fastify (`@nestjs/platform-fastify`) |
| :--- | :--- | :--- |
| **Ecosystem & Maturity** | Largest ecosystem in Node.js; universally compatible middleware | Rapidly growing; plugin-centric architecture |
| **Raw Throughput** | ~15,000 - 25,000 req/sec | ~45,000 - 75,000 req/sec (up to 2x - 3x faster) |
| **Streaming Uploads** | Buffers multipart payloads to disk/memory first | Supports true streaming uploads via `FileStreamInterceptor` |
| **CORS Default Methods** | `GET, HEAD, PUT, PATCH, POST, DELETE` | Safelisted only: `GET, HEAD, POST` (PUT/PATCH/DELETE require explicit config) |
| **Security Headers** | Supported natively via `app.useSecurityHeaders()` | Supported natively via `app.useSecurityHeaders()` |
| **Cookie Parsing** | Built-in via NestJS 12.1+ or `cookie-parser` | Built-in via NestJS 12.1+ or `@fastify/cookie` |
| **Native Response Object** | `res.send()`, `res.cookie()` (Express `Response`) | `reply.send()`, `reply.setCookie()` (`FastifyReply`) |

---

## Architectural Commitments for `@aaraj`

1. **Explicit API Versioning**: All public endpoints exposed by `@aaraj/api` must use deterministic **URI Versioning** (`v1`, `v2`) to allow non-breaking backwards compatibility.
2. **Platform-Agnostic Response Handling**: Route handlers should avoid library-specific response objects (`@Res() res: Response`) unless `passthrough: true` is configured. Always favor standard return values or `StreamableFile`.
3. **Defense-in-Depth Cookie Security**: All sensitive cookies (auth tokens, session IDs) must enforce `httpOnly: true`, `secure: true`, and `sameSite: 'lax'` or `'strict'`.
4. **Resilient SSE Connections**: Real-time push streams using `@Sse()` must bind `@SseSignal()` and RxJS `finalize()` operators to guarantee immediate resource deallocation when clients disconnect.
