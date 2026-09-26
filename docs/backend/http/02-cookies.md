# 02 - Cookies

> **Source Reference**: [NestJS Official Documentation - Cookies](https://docs.nestjs.com/http/cookies)

HTTP cookies allow servers to persist stateful data across HTTP requests. Starting with **NestJS v12.1**, cookie reading, writing, and signing are built directly into the NestJS core framework across all HTTP adapters (Express and Fastify), eliminating the mandatory requirement for third-party middleware packages like `cookie-parser` or `@fastify/cookie`.

---

## 1. Native Cookie Architecture (NestJS v12.1+)

The native NestJS cookie system provides:
- **`@Cookies()`** and **`@SignedCookies()`** parameter decorators to read incoming cookies.
- **`httpAdapter.setCookie()`** and **`httpAdapter.clearCookie()`** on `AbstractHttpAdapter` to set and clear cookies platform-agnostically.
- Built-in **HMAC-SHA256 signature verification** and secret rotation via application options.

---

## 2. Reading Cookies

Use `@Cookies()` to extract cookies from the request. Pass a cookie name to extract a single cookie value, or omit it to retrieve a key-value dictionary of all cookies:

```typescript
// src/preferences/preferences.controller.ts
import { Controller, Cookies, Get, ParseIntPipe } from '@nestjs/common';

@Controller('preferences')
export class PreferencesController {
  @Get()
  getAllPreferences(@Cookies() allCookies: Record<string, string>) {
    return allCookies;
  }

  @Get('theme')
  getTheme(@Cookies('theme') theme?: string) {
    return { theme: theme ?? 'system' };
  }

  @Get('cart')
  getCartSize(
    @Cookies('cartSize', new ParseIntPipe({ optional: true })) cartSize?: number,
  ) {
    return { cartSize: cartSize ?? 0 };
  }
}
```

> [!NOTE]
> - Named cookies that are missing resolve to `undefined`.
> - Values are automatically percent-decoded.
> - Pipes receive cookie parameters with `ArgumentMetadata.type = 'custom'`. Global `ValidationPipe` skips them unless `validateCustomDecorators: true` is enabled.

> [!WARNING]
> Values extracted by `@Cookies()` are unverified plain text sent by the client. For sensitive identifiers (user IDs, tokens, session keys), always use **`@SignedCookies()`**.

---

## 3. Setting & Clearing Cookies

Cookies are written via the HTTP adapter using the injected `HttpAdapterHost`. Inject the native response with `@Res({ passthrough: true })` so that NestJS continues handling the return value:

```typescript
// src/preferences/preferences.controller.ts
import { Body, Controller, Delete, Put, Res } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Controller('preferences')
export class PreferencesController {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  @Put('theme')
  setTheme(
    @Body('theme') theme: string,
    @Res({ passthrough: true }) res: unknown,
  ) {
    this.adapterHost.httpAdapter.setCookie(res, 'theme', theme, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year, in SECONDS
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    });

    return { success: true, theme };
  }

  @Delete('theme')
  clearTheme(@Res({ passthrough: true }) res: unknown) {
    this.adapterHost.httpAdapter.clearCookie(res, 'theme', {
      path: '/',
    });
    return { success: true };
  }
}
```

> [!CAUTION]
> **`maxAge` is in SECONDS**:
> Unlike Express's native `res.cookie()` which accepts milliseconds, NestJS adapter's `setCookie()` adheres to RFC 6265 and accepts `maxAge` in **seconds** (matching `@fastify/cookie`). Passing `60 * 1000` sets a cookie for 16.6 hours instead of 60 seconds!

### `CookieSerializeOptions` Reference

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `path` | `string` | `'/'` | Cookie scope path. |
| `domain` | `string` | *not set* | Host scope (omitted means host-only cookie). |
| `maxAge` | `number` | *not set* | Lifetime in **seconds** (integer). |
| `expires` | `Date` | *not set* | Expiration timestamp. |
| `httpOnly` | `boolean` | `false` | Blocks JavaScript access via `document.cookie`. |
| `secure` | `boolean` | `false` | Requires HTTPS. Required when `sameSite: 'none'`. |
| `sameSite` | `'strict' \| 'lax' \| 'none'` | *not set* | Controls cross-site request cookie transmission. |
| `partitioned` | `boolean` | `false` | Enables Cookies Having Independent Partitioned State (CHIPS). |
| `priority` | `'low' \| 'medium' \| 'high'` | *not set* | Chromium-specific eviction priority. |
| `signed` | `boolean` | `false` | Signs the cookie value using the configured HMAC secret. |

---

## 4. Signing Cookies & Secret Rotation

A signed cookie appends an HMAC-SHA256 signature to the cookie value, allowing the backend to verify that the value was not altered by the client.

### Enabling Signed Cookies

Pass the secret in `NestFactory.create()`:

```typescript
// src/main.ts
const app = await NestFactory.create(AppModule, {
  cookies: {
    secret: process.env.COOKIE_SECRET,
  },
});
```

### Rotating Secrets Safely

To rotate secrets without logging out active users, pass an **array of secrets**. NestJS signs new cookies with the **first** secret and verifies incoming cookies against **all** secrets in constant time:

```typescript
// src/main.ts
const app = await NestFactory.create(AppModule, {
  cookies: {
    // Index 0: active secret for new cookies
    // Index 1+: historical secrets for verification
    secret: [
      process.env.COOKIE_SECRET_CURRENT!,
      process.env.COOKIE_SECRET_PREVIOUS!,
    ],
  },
});
```

### Setting and Reading Signed Cookies

```typescript
// src/auth/auth.controller.ts
import { Controller, Get, Post, Res, SignedCookies, UnauthorizedException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Controller('auth')
export class AuthController {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  @Post('session')
  createSession(@Res({ passthrough: true }) res: unknown) {
    const userId = 'usr_1024';

    this.adapterHost.httpAdapter.setCookie(res, 'uid', userId, {
      signed: true,
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24, // 24 hours in seconds
    });

    return { message: 'Session created' };
  }

  @Get('session')
  getSession(@SignedCookies('uid') userId?: string) {
    if (!userId) {
      throw new UnauthorizedException('Invalid or missing signed session cookie');
    }
    return { userId };
  }
}
```

> [!NOTE]
> `@SignedCookies('uid')` returns `undefined` if:
> - The cookie is missing
> - The cookie is not signed
> - The signature is invalid or tampered with
> - The cookie was signed with a secret not present in the current configured secrets list

---

## 5. Security & Input Validation

NestJS `setCookie()` and `clearCookie()` actively guard against HTTP header injection (CRLF):
- Cookie names must be valid RFC 7230 tokens (no spaces, `=`, `;`, or control characters).
- Attributes with invalid characters (`path` with `;`, invalid domains) throw a `TypeError`.
- Setting `sameSite: 'none'` or `partitioned: true` without `secure: true` throws a `TypeError`.
- Cookie values are percent-encoded via `encodeURIComponent()` and decoded by `@Cookies()`, ensuring safe transport of arbitrary strings.

---

## 6. Compatibility with `cookie-parser` & `@fastify/cookie`

If migrating an existing application using `cookie-parser` or `@fastify/cookie`:
1. If `cookie-parser` is applied, `@Cookies()` returns `req.cookies` populated by the middleware.
2. If `cookies.secret` is set in NestJS options, `@SignedCookies()` verifies against the raw `Cookie` header using Nest secrets, taking precedence over `req.signedCookies`.
3. Cookie signature format uses standard `cookie-signature` (`s:<value>.<hmac>`), ensuring interoperability with Express sessions and Fastify signed cookies.
