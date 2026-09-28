# 05 - Error Monitoring

> **Source Reference**: [NestJS Official Documentation - Error Monitoring](https://docs.nestjs.com/observability/error-monitoring)

Error monitoring is a foundational capability included across all plans in NestJS Observe. When an exception escapes a controller, GraphQL resolver, WebSocket gateway, or BullMQ queue processor, it is automatically captured alongside its complete request context, stack trace, source lines, and distributed trace timeline.

---

## 1. What Gets Captured Automatically

Errors propagating out of an instrumented endpoint are recorded directly on the failed execution without registering manual error hooks or modifying [Exception Filters](file:///home/solo/JUNK/OFC/LK/aaraj/docs/backend/overview/06-exception-filters.md).

An error execution page brings together:
1. **Error Identity**: Exception class name and human-readable message.
2. **Stack Trace & Source Context**: Trimmed in-app stack frames with lines of source code surrounding the failure.
3. **Request State**: Inbound headers allowlist and optional scrubbed request body.
4. **Trace Waterfall**: The active spans leading up to the exact moment of failure.
5. **Correlated Logs**: All `Logger` output emitted during that request.

---

## 2. Intentional Exceptions vs. Unhandled Defects

Not every failed request represents a system defect:

| Exception Type | Example | Counted in Errors View? | Treated as a New Defect for Alerts? |
| :--- | :--- | :---: | :---: |
| **Intentional Client Error** | `NotFoundException`, `BadRequestException` (4xx) | **Yes** (Failed Request) | **No** (Expected client behavior) |
| **Unhandled Server Error** | `InternalServerErrorException`, `TypeError`, `QueryFailedError` (5xx) | **Yes** | **Yes** (Triggers defect alerting) |
| **Worker / RPC Failure** | Queue processor throws an unhandled error | **Yes** | **Yes** (Triggers defect alerting) |

---

## 3. Source Context Configuration

Stack traces from production often point to compiled JavaScript files (`dist/main.js:42:15`). The `sourceContext` option extracts lines of source code directly from your project repository, displaying the exact lines where the failure occurred:

```typescript
// src/app.module.ts
export const { ObserveModule, ObserveInstrument } = createObserveModule({
  sourceContext: {
    linesOfContext: 5, // Read 5 lines before and after throwing line
    maxFrames: 5,      // Inspect top 5 in-app stack frames
    sourceMaps: false, // Set true if running compiled output without --enable-source-maps
  },
});
```

> [!TIP]
> **Source Map Support in Node.js**:
> To resolve TypeScript source files natively with zero performance penalty, start Node.js with:
> ```bash
> node --enable-source-maps dist/main.js
> ```
> Or in development: `process.setSourceMapsEnabled(true)`.

> [!WARNING]
> Frames residing in `node_modules` or Node.js internal libraries (`node:fs`, `node:events`) are **never read or uploaded**, ensuring third-party code does not leak into telemetry.

---

## 4. Capturing Handled Exceptions (`captureError`)

When catching and mitigating an error inside application logic, report it manually via `TracerService` to ensure visibility in the dashboard:

```typescript
// src/webhooks/webhook.service.ts
import { Injectable } from '@nestjs/common';
import { TracerService } from '@nestjs/observe';

@Injectable()
export class WebhookService {
  constructor(private readonly tracerService: TracerService) {}

  async dispatchWebhook(payload: Record<string, any>) {
    try {
      await this.sendHttp(payload);
    } catch (err) {
      await this.tracerService.captureError(err as Error, {
        destinationUrl: payload.url,
        isRetryable: 'true',
      });
      // Fallback: enqueue to dead-letter queue
      await this.deadLetterQueue.add('failed-webhook', payload);
    }
  }

  private async sendHttp(data: any) {}
}
```

---

## 5. Grouping Errors into Defects

A high-traffic incident producing 10,000 exceptions represents **one underlying defect**, not 10,000 separate issues.

The **Group into defects** feature fingerprints errors server-side by analyzing:
- Exception class name (`TypeError`, `PrismaClientKnownRequestError`)
- Normalized stack trace frame shapes (ignoring line variations caused by unrelated file edits)

### Defect Lifecycle States

| State | Semantic Meaning | Behavior upon Recurrence |
| :--- | :--- | :--- |
| **Open** | Active defect requiring engineering triage. | Increments occurrence counter. |
| **Resolved** | Claim that a code fix has been deployed. | **Reopens immediately** if the error recurs in subsequent releases. |
| **Ignored** | Deliberate decision that the error is known noise. | Stays ignored; suppresses future notifications. |

---

## 6. From Error to AI-Assisted Fix

Every failed request or error detail card in NestJS Observe features a **Copy agent prompt** button.

Clicking this button generates a self-contained markdown diagnostic prompt containing:
1. The throwing exception, normalized stack trace, and highlighted source lines.
2. The endpoint route, HTTP method, and client metadata.
3. The trace waterfall showing which operations ran immediately prior to failure.
4. All correlated log messages emitted during execution.
5. Standard prompt instructions asking the agent (Claude Code, Cursor, Copilot) to identify the root cause and propose a code diff with tests.
