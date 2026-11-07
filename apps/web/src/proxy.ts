import { NextResponse, type NextRequest } from "next/server";
import { getGtmIdForRequestHost } from "@/lib/gtm-config";

const trackingHosts = {
  googleTag: "https://googletagmanager.com https://*.googletagmanager.com",
  google: "https://google.com https://*.google.com",
  analytics: "https://google-analytics.com https://*.google-analytics.com",
  googleStatic: "https://gstatic.com https://*.gstatic.com",
  meta: "https://facebook.com https://*.facebook.com https://facebook.net https://*.facebook.net https://fbcdn.net https://*.fbcdn.net",
  stape: "https://in.stape.io https://*.in.stape.io",
  helperCdn:
    "https://jsdelivr.net https://*.jsdelivr.net https://unpkg.com https://*.unpkg.com",
};

const sources = (...groups: string[]) => groups.join(" ");

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const isAdmin = request.nextUrl.pathname.startsWith("/admin");
  const hasStorefrontGtm =
    !isAdmin && Boolean(getGtmIdForRequestHost(request.headers.get("host")));
  const storefrontOnly = (sources: string) =>
    hasStorefrontGtm ? ` ${sources}` : "";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      isDevelopment ? " 'unsafe-eval'" : ""
    }`,
    `script-src-elem 'self' 'nonce-${nonce}'${storefrontOnly(
      sources(
        trackingHosts.googleTag,
        trackingHosts.google,
        trackingHosts.analytics,
        trackingHosts.googleStatic,
        trackingHosts.meta,
        trackingHosts.stape,
        trackingHosts.helperCdn,
      ),
    )}`,
    `style-src 'self' ${
      isDevelopment ? "'unsafe-inline'" : `'nonce-${nonce}'`
    }${storefrontOnly(
      sources(
        trackingHosts.googleTag,
        trackingHosts.google,
        "https://fonts.googleapis.com",
      ),
    )}`,
    ...(!isAdmin && !isDevelopment ? ["style-src-attr 'unsafe-inline'"] : []),
    `img-src 'self' blob: data:${storefrontOnly(
      sources(
        trackingHosts.googleTag,
        trackingHosts.analytics,
        trackingHosts.google,
        trackingHosts.googleStatic,
        trackingHosts.stape,
        trackingHosts.meta,
      ),
    )}`,
    `connect-src 'self'${storefrontOnly(
      sources(
        trackingHosts.googleTag,
        trackingHosts.analytics,
        trackingHosts.google,
        trackingHosts.stape,
        trackingHosts.meta,
      ),
    )}`,
    `font-src 'self'${storefrontOnly(
      sources(trackingHosts.googleStatic, "data:"),
    )}`,
    `frame-src 'self'${storefrontOnly(
      sources(
        trackingHosts.googleTag,
        trackingHosts.google,
        trackingHosts.stape,
      ),
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
      source: "/((?!api|_next/static|_next/image).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
