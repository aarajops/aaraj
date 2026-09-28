# 08 - HTTP Client

> **Source Reference**: [NestJS Official Documentation - HTTP Client](https://docs.nestjs.com/application/http-client)

Modern microservices and distributed backends continuously interact with upstream HTTP services. NestJS provides the `@nestjs/http-client` package, built natively upon Node's modern global `fetch` API (undici).

It replaces the legacy Axios-based `@nestjs/axios` package, bringing native promises, zero external client dependencies, built-in exponential backoff retries with full jitter, typed responses, path segment interpolation, and first-class NestJS exception mapping.

---

## 1. Installation & Registration

```bash
pnpm --filter @aaraj/api add @nestjs/http-client
```

### Module Registration

Register clients with base URLs, headers, and default timeouts:

```typescript
// src/integrations/github/github.module.ts
import { Module } from '@nestjs/common';
import { HttpClientModule } from '@nestjs/http-client';
import { GithubService } from './github.service.js';

@Module({
  imports: [
    HttpClientModule.register({
      name: 'github', // Named client
      baseUrl: 'https://api.github.com',
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'aaraj-api-v1',
      },
      timeout: '5s',
    }),
  ],
  providers: [GithubService],
  exports: [GithubService],
})
export class GithubModule {}
```

### Application-Wide Defaults (`forRoot`)

Configure shared policies (such as user-agent or base retry policies) in `AppModule`:

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { HttpClientModule } from '@nestjs/http-client';

@Module({
  imports: [
    HttpClientModule.forRoot({
      headers: { 'x-service-source': 'aaraj-api' },
      timeout: '10s',
    }),
  ],
})
export class AppModule {}
```

---

## 2. Injecting & Making Requests

Inject named clients using `@InjectHttpClient('name')`:

```typescript
// src/integrations/github/github.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpClient, InjectHttpClient, toHttpException } from '@nestjs/http-client';

export interface GithubRepo {
  id: number;
  name: string;
  stargazers_count: number;
}

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  constructor(
    @InjectHttpClient('github')
    private readonly githubClient: HttpClient,
  ) {}

  async getRepository(owner: string, repo: string): Promise<GithubRepo> {
    try {
      const { data, status } = await this.githubClient.get<GithubRepo>(
        '/repos/:owner/:repo',
        {
          params: { owner, repo }, // Safe segment interpolation
          query: { timestamp: Date.now() },
        },
      );

      this.logger.log(`Fetched repo ${owner}/${repo} with status ${status}`);
      return data;
    } catch (error) {
      // Maps HttpClientError into appropriate NestJS HttpException (502 / 504)
      throw toHttpException(error);
    }
  }

  async createIssue(owner: string, repo: string, title: string, body: string) {
    try {
      const { data } = await this.githubClient.post(
        '/repos/:owner/:repo/issues',
        {
          params: { owner, repo },
          json: { title, body }, // Automatically stringifies and sets content-type
        },
      );
      return data;
    } catch (error) {
      throw toHttpException(error);
    }
  }
}
```

---

## 3. Path & Query Parameter Interpolation

The client handles path parameter interpolation and query serialization safely without fragile string concatenation:

- **Path Parameters (`params`)**: Values in `:name` are URI-encoded automatically. Missing segments or unexpected path traversal values (`..`) throw immediately.
- **Query Parameters (`query`)**: Objects or `URLSearchParams`. Arrays repeat the key (`tags=a&tags=b`), dates convert to ISO strings, and `undefined`/`null` keys are stripped.

---

## 4. Built-in Retries with Exponential Backoff & Jitter

`@nestjs/http-client` has **retries enabled by default** for idempotent HTTP methods (`GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`).

It automatically retries when encountering:
- Network disconnects (DNS failures, connection resets).
- Per-attempt timeouts.
- Transient HTTP status codes: `408`, `429`, `500`, `502`, `503`, and `504`.

Between failed attempts, it applies exponential backoff with full jitter (randomized backoff to prevent thundering herd spikes against upstream services).

### Customizing Retry Policy

```typescript
HttpClientModule.register({
  name: 'payments',
  baseUrl: 'https://api.stripe.com/v1',
  retry: {
    attempts: 4, // 1 initial + 3 retries
    backoff: {
      delay: '200ms',
      factor: 2,
      maxDelay: '5s',
      jitter: 'full',
    },
    statusCodes: [429, 500, 502, 503, 504],
  },
})
```

### Non-Idempotent Methods (`POST`, `PATCH`) & Idempotency Keys
`POST` and `PATCH` are **not** retried by default to prevent double-charging or duplicate resource creation. When an API supports idempotency keys, explicitly enable retry for that specific request:

```typescript
await this.paymentsClient.post('/v1/charges', {
  json: { amount: 5000, currency: 'usd' },
  headers: { 'idempotency-key': `charge_${orderId}` },
  retry: { methods: ['POST'] }, // Safely opt-in because key guarantees single execution
});
```

---

## 5. Timeouts & Overall Deadlines

- `timeout`: Configures timeout **per attempt** (e.g. `'3s'`).
- `signal`: Cancels the request using standard `AbortSignal`.

Because retries can trigger multiple attempts, an overall request deadline should be bound via `AbortSignal.timeout()`:

```typescript
const { data } = await this.client.get('/critical-data', {
  timeout: '2s',                           // Each attempt allowed 2 seconds
  signal: AbortSignal.timeout(6_000),      // Entire operation must complete within 6s
});
```

---

## 6. Error Handling & Exception Mapping (`toHttpException`)

When upstream calls fail, `@nestjs/http-client` throws typed errors extending `HttpClientError`:

| Error Class | Trigger | Default `toHttpException` Mapping |
| :--- | :--- | :--- |
| `HttpResponseError` | Upstream returned non-2xx status code | `502 Bad Gateway` (or forwarded status) |
| `HttpTimeoutError` | Timeout elapsed on last attempt | `504 Gateway Timeout` |
| `HttpNetworkError` | DNS resolution failed or socket reset | `502 Bad Gateway` |
| `HttpParseError` | Response body was not valid JSON | `502 Bad Gateway` |

Using `toHttpException(error)` automatically logs the upstream failure with sanitized URLs (query secrets masked) and returns the standard HTTP gateway error to the client.

---

## 7. HTTP Interceptors

Interceptors wrap outgoing HTTP calls, allowing token injection, metric collection, and distributed tracing headers:

```typescript
// src/integrations/auth-interceptor.ts
import { Injectable } from '@nestjs/common';
import type { HttpClientInterceptor, HttpHandler, HttpRequest } from '@nestjs/http-client';
import { AuthService } from '../auth/auth.service.js';

@Injectable()
export class BearerAuthInterceptor implements HttpClientInterceptor {
  constructor(private readonly authService: AuthService) {}

  async intercept(request: HttpRequest, next: HttpHandler): Promise<Response> {
    const token = await this.authService.getInternalServiceToken();
    request.headers.set('authorization', `Bearer ${token}`);
    
    // Interceptors run once per attempt, ensuring fresh tokens on retry:
    return next(request);
  }
}
```
