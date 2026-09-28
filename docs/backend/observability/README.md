# NestJS Observability & APM Reference

> **Source Reference**: [NestJS Official Documentation - Observability](https://docs.nestjs.com/observability/overview)

Modern distributed backends require deep runtime visibility to diagnose latency regressions, isolate memory leaks, and rapidly remediate production errors. **NestJS Observe** (`@nestjs/observe`) is the official auto-instrumented Application Performance Monitoring (APM) and distributed observability platform designed natively for NestJS applications.

Unlike generic Node.js APM agents that treat application code as a black box between inbound HTTP sockets and raw database connections, NestJS Observe attaches directly to the **NestJS Request Lifecycle** (`instrument` application option introduced in `@nestjs/core` v11.1.4). Telemetry reflects the native architecture of controllers, providers, resolvers, interceptors, guards, pipes, and queue consumers.

---

## Observability Tier Table of Contents

| Chapter | Topic | Key Focus Areas |
| :--- | :--- | :--- |
| **01** | [Overview](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/observability/01-overview.md) | APM comparison, request lifecycle hooks, teams/projects/applications hierarchy, Observability Events (OEs) |
| **02** | [SDK Configuration](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/observability/02-sdk.md) | `createObserveModule()`, `ObserveInstrument`, Fastify 3rd-argument rule, database/HTTP auto-instrumentation, redaction, sampling |
| **03** | [Manual Instrumentation](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/observability/03-manual-instrumentation.md) | `TracerService`, `createSpan()`, `activeSpan()`, `captureError()`, `setAttribute()`, metrics (`counter`, `gauge`, `summary`) |
| **04** | [Distributed Tracing](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/observability/04-distributed-tracing.md) | Trace context propagation, HTTP `x-request-id`, gRPC metadata, BullMQ queue job inheritance, self-time waterfalls |
| **05** | [Error Monitoring](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/observability/05-error-monitoring.md) | Unhandled exceptions, stack traces with `sourceContext`, server-side defect fingerprinting, release regressions |
| **06** | [Dashboard & Analytics](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/observability/06-dashboard.md) | 3-tier navigation (Analytics → Operation → Execution), live Service Map, Profiler, SLO error budget burn rates |
| **07** | [MCP Server](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/observability/07-mcp-server.md) | Streamable HTTP MCP endpoint (`POST /mcp`), personal tokens, automated AI agent root-cause analysis |

---

## Generic Node.js APM vs. NestJS Observe

| Feature | Generic Node.js APM (Datadog, New Relic) | NestJS Observe (`@nestjs/observe`) |
| :--- | :--- | :--- |
| **Instrumentation Mechanism** | Monkey-patches core Node.js modules (`http`, `net`, `dns`) prior to imports | Native hook via `instrument: ObserveInstrument` in `NestFactory.create()` |
| **Trace Vocabulary** | Generic transport URLs (`POST /orders/checkout`) | Native class & method symbols (`OrdersController.checkout`, `PaymentsService.charge`) |
| **Performance Breakdown** | Coarse-grained network & DB I/O | True **self-time** per controller, service method, pipe, and guard |
| **Database Queries** | Raw SQL queries with manual scrubbing | Automated literal stripping (values replaced, comments scrubbed, N+1 folding) |
| **Queue & Worker Traces** | Requires manual span creation | Automatic trace inheritance across `@nestjs/bullmq` and `@nestjs/bull` |
| **Agent Prompt Integration** | Manual copying of log lines | 1-click **Copy agent prompt** and direct **MCP Server** query API |

---

## Architectural Commitments for `@aaraj`

1. **Non-Invasive Instrumentation**: The API gateway and backend microservices configure telemetry via `createObserveModule()` and `instrument: ObserveInstrument` without invasive global monkey-patching.
2. **Defensive Redaction**: Sensitive attributes (passwords, tokens, authorization headers, session cookies) are scrubbed at source prior to leaving the Node.js process using built-in redaction rules.
3. **Trace Coherence Across Transports**: Trace IDs must be propagated seamlessly across HTTP calls (`x-request-id`) and asynchronous BullMQ background jobs.
4. **AI-Assisted Incident Remediation**: Utilize the NestJS Observe MCP server to enable automated diagnostic agents to query active defects, trace waterfalls, and release regressions directly.
