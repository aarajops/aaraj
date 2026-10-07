import type { NextConfig } from "next";
import {
  API_V1_BASE_PATH,
  MAX_CATALOG_MEDIA_DERIVATIVE_BYTES,
} from "@aaraj/contracts";
import { getApiInternalUrl } from "./src/lib/api-internal-url.mjs";

const apiUrl = getApiInternalUrl();
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
    : []),
];

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@aaraj/contracts"],
  images: {
    localPatterns: [
      {
        pathname: `${API_V1_BASE_PATH}/catalog/media/*/*/*.webp`,
        search: "",
      },
    ],
    maximumResponseBody: MAX_CATALOG_MEDIA_DERIVATIVE_BYTES,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
