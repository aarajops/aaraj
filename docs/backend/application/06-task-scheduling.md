# 06 - Task Scheduling

> **Source Reference**: [NestJS Official Documentation - Task Scheduling](https://docs.nestjs.com/application/task-scheduling)

Task scheduling allows applications to run background jobs at fixed dates/times, recurring cron intervals, or after deterministic delays. Examples include nightly billing runs, cache invalidation cycles, database vacuuming, and periodic metrics flushes.

NestJS provides the `@nestjs/schedule` package, which integrates with the Node.js [cron](https://github.com/kelektiv/node-cron) package.

---

## 1. Installation & Module Initialization

```bash
pnpm --filter @aaraj/api add @nestjs/schedule
```

Import `ScheduleModule.forRoot()` into the root `AppModule`:

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ScheduleModule.forRoot(), // CRITICAL: Import ONLY once in root module!
  ],
})
export class AppModule {}
```

> **Warning (Multiple Imports)**: Never import `ScheduleModule.forRoot()` into multiple feature modules. Each `forRoot()` call registers another instance of the scheduler, causing every `@Cron()`, `@Interval()`, and `@Timeout()` job to execute multiple times per tick.

---

## 2. Declarative Cron Jobs (`@Cron`)

Decorate any provider method with `@Cron(expression, options)`:

```typescript
// src/tasks/tasks.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  // Using standard cron expression
  @Cron('0 2 * * *', {
    name: 'nightly-data-sync',
    timeZone: 'UTC',
    waitForCompletion: true, // Prevents concurrent runs if previous tick is still executing
  })
  async handleNightlySync() {
    this.logger.log('Starting nightly data synchronization...');
    // Long-running job...
  }

  // Using built-in CronExpression enum
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCacheCleanup() {
    this.logger.debug('Flushing expired memory cache entries...');
  }
}
```

### Standard Cron Pattern Reference

```text
* * * * * *
| | | | | |
| | | | | day of week (0 - 7, where 0 and 7 are Sunday)
| | | | months (1 - 12)
| | | day of month (1 - 31)
| | hours (0 - 23)
| minutes (0 - 59)
seconds (0 - 59, optional in standard 5-digit cron, supported in 6-digit)
```

Common expressions via `CronExpression`:
- `CronExpression.EVERY_30_SECONDS` (`*/30 * * * * *`)
- `CronExpression.EVERY_HOUR` (`0 0 * * * *`)
- `CronExpression.EVERY_DAY_AT_MIDNIGHT` (`0 0 0 * * *`)
- `CronExpression.EVERY_WEEK` (`0 0 0 * * 0`)

### Cron Options:

| Option | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Unique identifier to query or control the job via `SchedulerRegistry`. |
| `timeZone` | `string` | Moment/IANA timezone (e.g. `'America/New_York'`, `'Europe/London'`). |
| `waitForCompletion` | `boolean` | If `true`, skips new ticks while current execution is in flight. |
| `disabled` | `boolean` | If `true`, the job is loaded but never triggered. |

---

## 3. Declarative Intervals & Timeouts

### Intervals (`@Interval`)
Runs periodically at a fixed millisecond delay (backed by `setInterval`):

```typescript
@Interval('heartbeat', 30000)
handleHeartbeat() {
  this.logger.log('Application heartbeat tick (every 30s)');
}
```

### Timeouts (`@Timeout`)
Runs once after a fixed millisecond delay from application bootstrap (backed by `setTimeout`):

```typescript
@Timeout('delayed-warmup', 5000)
handleInitialWarmup() {
  this.logger.log('Executed 5 seconds after application startup');
}
```

Both `@Interval` and `@Timeout` automatically wrap their execution in a `try/catch` block so unhandled exceptions do not crash the Node.js event loop.

---

## 4. Dynamic Task Management (`SchedulerRegistry`)

When jobs must be scheduled dynamically at runtime (e.g. user-configured webhooks or tenant-specific reminders), inject `SchedulerRegistry`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

@Injectable()
export class DynamicSchedulerService {
  private readonly logger = new Logger(DynamicSchedulerService.name);

  constructor(private readonly schedulerRegistry: SchedulerRegistry) {}

  addDynamicCron(name: string, cronTime: string) {
    const job = new CronJob(cronTime, () => {
      this.logger.log(`Dynamic cron job [${name}] executed`);
    });

    this.schedulerRegistry.addCronJob(name, job);
    job.start();
    this.logger.log(`Registered and started dynamic cron: ${name}`);
  }

  stopCron(name: string) {
    const job = this.schedulerRegistry.getCronJob(name);
    job.stop();
  }

  deleteCron(name: string) {
    this.schedulerRegistry.deleteCronJob(name);
  }

  listAllCrons() {
    const jobs = this.schedulerRegistry.getCronJobs();
    jobs.forEach((job, name) => {
      this.logger.log(`Job: ${name} -> Next execution: ${job.nextDate().toISO()}`);
    });
  }
}
```

---

## 5. Multi-Instance Kubernetes Deployments (`@nestjs/locks`)

When deploying a NestJS application with multiple replicas (e.g. 5 Kubernetes pods behind a load balancer), standard `@Cron('0 2 * * *')` jobs will run on **all 5 pods simultaneously**, leading to duplicate invoices, duplicate emails, and database race conditions.

To ensure exactly **one instance** runs a job per tick, use `@OnOneInstance()` from `@nestjs/locks`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnOneInstance } from '@nestjs/locks';

@Injectable()
export class BillingJob {
  private readonly logger = new Logger(BillingJob.name);

  @Cron('0 2 * * *')
  @OnOneInstance({ key: 'billing:nightly-export' })
  async exportInvoices() {
    this.logger.log('Acquired distributed lock; generating customer invoices...');
    // Exactly one pod runs this; the other 4 pods skip this tick!
  }
}
```

Instances coordinate through a shared Redis or PostgreSQL lock store. The first pod to tick acquires the lease and renews it for the duration of the work. If that pod crashes mid-execution, the lease expires and another replica takes over on the next cycle.

---

## 6. Silence Detection & Observability

A major risk in production task scheduling is **silent failure**: a cron job ceases running because an unhandled runtime error descheduled the job or deployment configuration changed, but no error is thrown.

Best practices:
1. **Heartbeat Metrics**: Emit a Prometheus / Datadog counter or gauge upon every successful tick completion.
2. **Silence Alert Rules**: Configure alert rules: *"Trigger alert if `nightly-data-sync` has not reported a successful completion in the last 26 hours"*.
3. **Structured Tracing**: Wrap task executions with trace contexts so long-running operations appear as distinct root spans in APM dashboards.
