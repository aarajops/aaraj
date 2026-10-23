import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import {
  API_V1_BASE_PATH,
  MAX_CATALOG_MEDIA_DERIVATIVE_BYTES,
} from "@aaraj/contracts";
import { getApiInternalUrl } from "./src/lib/api-internal-url.mjs";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(appDirectory, "../..");

function getReleaseBuildId(): string {
  const configured =
    process.env.RELEASE_COMMIT_SHA?.trim() || process.env.GITHUB_SHA?.trim();
  const commit =
    configured ||
    execFileSync("git", ["-C", monorepoRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error("RELEASE_COMMIT_SHA must be a full Git commit SHA.");
  }
  return commit.toLowerCase();
}

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
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  generateBuildId: async () => getReleaseBuildId(),
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
        source: "/favicon.ico",
        destination: "/aaraj-icon.svg",
      },
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
