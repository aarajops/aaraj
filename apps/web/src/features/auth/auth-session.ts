import "server-only";

import { headers } from "next/headers";
import type { authClient } from "@/features/auth/auth-client";
import { getApiInternalUrl } from "@/lib/api-internal-url.mjs";
import {
  API_V1_BASE_PATH,
  EffectiveAccessSchema,
  type EffectiveAccess,
} from "@aaraj/contracts";

export type InitialSession = typeof authClient.$Infer.Session | null;

export async function getInitialSession(): Promise<InitialSession> {
  const cookie = (await headers()).get("cookie");
  if (!cookie) return null;

  try {
    const response = await fetch(
      `${getApiInternalUrl()}/api/auth/get-session`,
      {
        headers: { cookie },
        cache: "no-store",
      },
    );

    if (!response.ok) return null;
    return (await response.json()) as InitialSession;
  } catch {
    return null;
  }
}

export async function getInitialAccess(): Promise<EffectiveAccess | null> {
  const cookie = (await headers()).get("cookie");
  if (!cookie) return null;

  try {
    const response = await fetch(
      `${getApiInternalUrl()}${API_V1_BASE_PATH}/access/me`,
      {
        headers: { cookie },
        cache: "no-store",
      },
    );

    if (!response.ok) return null;
    const access = EffectiveAccessSchema.safeParse(await response.json());
    return access.success ? access.data : null;
  } catch {
    return null;
  }
}
