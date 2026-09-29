import { headers } from "next/headers";
import type { authClient } from "@/lib/auth-client";

export type InitialSession = typeof authClient.$Infer.Session | null;

export async function getInitialSession(): Promise<InitialSession> {
  const cookie = (await headers()).get("cookie");
  if (!cookie) return null;

  const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:3001";

  try {
    const response = await fetch(`${apiUrl}/api/auth/get-session`, {
      headers: { cookie },
      cache: "no-store",
    });

    if (!response.ok) return null;
    return (await response.json()) as InitialSession;
  } catch {
    return null;
  }
}
