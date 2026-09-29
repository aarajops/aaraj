import { createAuthClient } from "better-auth/react";

// Next.js rewrites /api/* to the NestJS API, so auth stays same-origin in the browser.
export const authClient = createAuthClient();
