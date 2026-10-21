import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthPanel } from "@/features/auth/auth-panel";
import type { EffectiveAccess } from "@aaraj/contracts";
import {
  getInitialAccess,
  getInitialSession,
} from "@/features/auth/auth-session";

export const metadata: Metadata = {
  title: "Your account",
  description: "Sign in to or create your Aaraj account.",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const initialSession = await getInitialSession();
  let initialAccess: EffectiveAccess | null = null;

  if (initialSession) {
    initialAccess = await getInitialAccess();
    if (initialAccess?.permissions.includes("catalog.manage")) {
      redirect("/admin");
    }
  }

  return <AuthPanel initialSession={initialSession} />;
}
