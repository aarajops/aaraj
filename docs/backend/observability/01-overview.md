# 01 - Observability Overview

> **Source Reference**: [NestJS Official Documentation - Observability Overview](https://docs.nestjs.com/observability/overview)

[NestJS Observe](https://www.observe.nestjs.com/) is the official, auto-instrumented Application Performance Monitoring (APM) and observability platform tailored specifically for NestJS applications. By installing the `@nestjs/observe` SDK and providing project API credentials, a NestJS service immediately begins streaming requests, background jobs, unhandled errors, logs, runtime profiles, and distributed traces to a centralized dashboard—requiring zero manual span wiring, schema definitions, or external collector daemons.

---

## 1. How NestJS Observe Differs from Generic Node.js APMs

Generic APM agents (e.g. Datadog, New Relic, Dynatrace) wrap the low-level Node.js `http` server and native database drivers, treating everything inside application memory as an opaque black box.

In contrast, **NestJS Observe** hooks directly into the framework's internal request execution pipeline via the `instrument` option of `NestFactory.create()` (available since `@nestjs/core` v11.1.4):
- **Domain Vocabulary**: Telemetry is expressed in terms of application classes and methods (`OrdersService.recalculate`, `AuthGuard.canActivate`) rather than bare URLs (`POST /orders/calculate`).
- **Self-Time Attribution**: The profiler isolates exact time spent inside a method's own CPU execution, subtracting time spent waiting on downstream asynchronous calls or database operations.
- **Native Lifecycle Coverage**: Telemetry captures controllers, providers, resolvers, interceptors, pipes, guards, and queue consumers as Nest wires them—without process-wide monkey-patching or brittle import-order dependencies.

---

## 2. Core Capabilities

| Capability | Description |
| :--- | :--- |
| **Request Monitoring** | Measures throughput, latency (average and p95), and failure rate across HTTP, GraphQL, gRPC, and microservice transports. |
| **Distributed Tracing** | Full waterfall visualization of every span executed by a request, ranked by self-time with cross-service trace correlation. |
| **Error Monitoring** | Captures unhandled exceptions with full stack traces, active request context, and source code lines surrounding the failing frame. |
| **Background Jobs** | Dedicated monitoring for queue consumers (BullMQ, Bull) and cron schedules, tracking wait time, execution duration, and retries. |
| **Services Breakdown** | Class-by-class and method-by-method accounting of own time versus total time across the application. |
| **Runtime Profiling** | In-process sampling of CPU usage, heap memory, event loop latency, and garbage collection metrics compared across instances. |
| **Release Comparison** | Correlates telemetry against `serviceVersion` (git commit hash or semantic release) to instantly highlight regressions. |
| **Custom Metrics** | In-code counters, gauges, and summary distributions reported via `TracerService`. |
| **User Journey Tracking** | Associates user identifiers with telemetry to inspect individual user paths, action replays, and per-user error rates. |
| **Copy Agent Prompt** | One-click button that packages failed requests or slow traces into markdown prompts for AI coding agents. |

---

## 3. Organizational Hierarchy

NestJS Observe organizes telemetry across three structural layers:

```text
Team (Organization & Billing)
 └── Project (e.g., "araz-production", "araz-staging")
      ├── Application 1: "araz-api" (Main REST API)
      ├── Application 2: "araz-worker" (BullMQ Job Processor)
      └── Application 3: "araz-gateway" (Reverse Ingress)
```

1. **Team**: The root administrative entity managing user memberships, access roles (**Read**, **Write**, **Admin**), and subscriptions.
2. **Project**: A collection of applications that ship together within an environment. Alerts, issues, SLOs, and API keys are scoped to a project.
3. **Application**: A distinct NestJS service (a web API, worker, or microservice) running the SDK and reporting under a unique `serviceId`.

---

## 4. Ingestion Metering & Spend Controls

Telemetry consumption is measured in **Observability Events (OEs)**:
- **1 OE** is charged per inbound request, background job run, error, forwarded log entry, or custom span reported.
- **Non-Billed Spans**: Database query spans and outbound HTTP requests are **free of charge**; they attach as metadata to an existing method span and do not consume OE quota.

### Spend Controls

Ingestion volume can be limited without deploying code changes via project-level spend controls:
- **Trace-Coherent Sampling**: Proportionally sample traces (e.g. keep 20% of healthy traces).
- **Per-Minute Rate Caps**: Guard against sudden traffic spikes exceeding monthly allowances.
- **Drop Filters**: Discard known-noisy endpoints (such as `/health` probes).

> [!NOTE]
> Errors and defect occurrences are **never sampled or dropped** by spend controls, ensuring 100% visibility into application failures.

---

## 5. Setting Up a Project

1. Sign up at [observe.nestjs.com](https://www.observe.nestjs.com/).
2. Create a **Project** (e.g., `araz-api-production`).
3. Add an **Application** representing your service (`araz-server`).
4. Generate an **API Key Pair** (`appKey` and `appSecret`) from the project's **API Keys** page. Store these credentials securely in environment variables (`OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`).
5. Instrument the application using the `@nestjs/observe` SDK.
