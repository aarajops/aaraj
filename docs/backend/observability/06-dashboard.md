# 06 - Dashboard & Analytics

> **Source Reference**: [NestJS Official Documentation - Dashboard](https://docs.nestjs.com/observability/dashboard)

The **NestJS Observe Dashboard** provides unified, real-time visualization of application performance, distributed traces, system topology, and runtime health without requiring custom Grafana queries or manual dashboard building.

---

## 1. The Three-Tier Navigation Hierarchy

All telemetry in NestJS Observe is structured into three progressive analytical levels:

```text
[1. Analytics View] ──▶ High-level route / job table (throughput, p95 latency, error rates)
         │
         ▼
[2. Operation View] ──▶ Single route (e.g. GET /api/orders/:id) across time and releases
         │
         ▼
[3. Execution View] ──▶ A single transaction (waterfall, spans, logs, errors, headers)
```

1. **Analytics (List View)**: Aggregated summaries across all endpoints, background jobs, or custom metrics. Used to detect anomalies and identify bottlenecks.
2. **Operation View**: Focused view of a specific route or queue job over time. Confirms whether a latency regression is constant or intermittent, and whether it correlates with a deploy.
3. **Execution View**: Granular diagnostics for an individual execution—inspecting the exact trace waterfall, self-time rankings, correlated logs, and throwing frames.

---

## 2. Telemetry Views Directory

| View | Purpose |
| :--- | :--- |
| **Requests** | Inbound HTTP, GraphQL, gRPC, WebSocket, and microservice calls broken down by operation. |
| **Services** | Class-by-class and method-by-method breakdown of own time vs. total time across all NestJS providers. |
| **Errors** | Aggregated unhandled defects and intentional failures with stack traces and source lines. |
| **Jobs** | Background queues (BullMQ, Bull) and cron schedules tracking queue wait duration and retries. |
| **Spans** | Global analytics across distinct span names (e.g. evaluating `OrdersService.recalculate` across all endpoints). |
| **Traces** | End-to-end trace waterfalls showing parent-child hierarchy across distributed services. |
| **Users** | User-centric activity tracking: user failure rates, action replays, and domain rollups when `getUserId` is configured. |
| **Custom** | Real-time charts of user-defined metrics reported via `TracerService` (`counter`, `gauge`, `summary`). |
| **Releases** | Side-by-side release comparisons (`serviceVersion`) tracking throughput, p95 latency, and error rate changes. |
| **Logs** | Centralized application logs forwarded via `ConsoleLogger`, placed chronologically on the trace clock. |
| **Profiler** | Host-level diagnostics: CPU usage, heap allocation, event loop latency, and garbage collection pauses. |

---

## 3. Dynamic Service Map

The **Activity → Map** view automatically generates an interactive topological map of your architecture without manual configuration:

```text
[API Gateway] ────────▶ [Worker Application]
      │                         │
      ├──▶ [PostgreSQL]         └──▶ [Redis Queue]
      └──▶ [Stripe API]
```

- **Node Types**: Applications, databases (per driver), queues, and external third-party APIs.
- **Traffic Volume**: Line thickness and animation speed represent request velocity.
- **Health Indicators**:
  - **Teal**: Error rate < 1%
  - **Soft Red**: Error rate between 1% and 5%
  - **Full Red**: Error rate > 5%

---

## 4. Alerting & Anomaly Detection

Alert rules notify teams before outages impact users.

### Alert Rule Families

| Family | Monitored Metric | Typical Trigger |
| :--- | :--- | :--- |
| **Request** | Error rate, p95 latency, throughput | p95 latency > 800ms for 5 minutes |
| **Job** | Job failure rate, queue wait time | BullMQ wait time > 30 seconds |
| **Absence** | Telemetry silence, job silence | Service heartbeats stop for > 2 minutes |
| **Logs** | Matching log patterns | Pattern `payment_gateway_down` occurs > 5 times |
| **Errors** | New error groups | First occurrence of an unhandled defect |
| **Runtime** | Event loop delay, memory leak | Event loop latency > 100ms |
| **SLO** | Error budget burn rate | Fast burn rate exceeding 14.4× |

### Threshold Modes

- **Fixed Threshold**: Triggers when an absolute value is crossed (e.g. `error_rate > 5%`).
- **Anomaly Detection**: Dynamically compares the current reading against the service's recent historical baseline, flagging unexpected deviations without brittle hardcoded limits.

---

## 5. Service Level Objectives (SLOs) & Error Budgets

SLOs translate technical error metrics into business commitments:

1. **Service Level Indicator (SLI)**: Ratio of successful events to total events (e.g., requests completing without a 5xx error in < 500ms).
2. **Objective Target**: Required reliability percentage (e.g., `99.9%`) over a rolling window (7, 14, 28, or 30 days).
3. **Error Budget**: Allowable margin of failure (`1 − Target = 0.1%`).
4. **Burn Rate**: Speed at which the error budget is being consumed:
   - **1.0×**: Exactly on schedule to exhaust budget at the end of the window.
   - **14.4× (Fast Burn)**: The entire 28-day budget will be depleted in ~2 days.

---

## 6. Closed-Loop Issue Verification

When an incident is investigated:
1. Promote an error group or slow operation into an **Issue**.
2. Deploy a fix stamped with a new `serviceVersion`.
3. Mark the issue as **Resolved**.
4. The Observe dashboard transitions the issue to **Verifying**, actively monitoring the affected endpoint against its pre-incident baseline.
5. If the fix holds, the issue **automatically closes**; if the regression recurs, it **reopens immediately** with the breaking reading.
