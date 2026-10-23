import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const isAdmin = request.nextUrl.pathname.startsWith("/admin");
  const storefrontOnly = (sources: string) => (isAdmin ? "" : ` ${sources}`);
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      isDevelopment ? " 'unsafe-eval'" : ""
    }`,
    `script-src-elem 'self' 'nonce-${nonce}'${storefrontOnly(
      "https://www.googletagmanager.com https://tagmanager.google.com",
    )}`,
    `style-src 'self' ${
      isDevelopment ? "'unsafe-inline'" : `'nonce-${nonce}'`
    }${storefrontOnly(
      "https://www.googletagmanager.com https://tagmanager.google.com https://fonts.googleapis.com",
    )}`,
    ...(!isAdmin && !isDevelopment
      ? ["style-src-attr 'unsafe-inline'"]
      : []),
    `img-src 'self' blob: data:${storefrontOnly(
      "https://www.googletagmanager.com https://*.google-analytics.com https://ssl.gstatic.com https://www.gstatic.com",
    )}`,
    `connect-src 'self'${storefrontOnly(
      "https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com",
    )}`,
    `font-src 'self'${storefrontOnly("https://fonts.gstatic.com data:")}`,
    `frame-src 'self'${storefrontOnly(
      "https://www.googletagmanager.com",
    )}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
