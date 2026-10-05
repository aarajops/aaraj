import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthPanel } from "@/features/auth/auth-panel";
import {
  getInitialAccess,
  getInitialSession,
} from "@/features/auth/auth-session";

export const metadata: Metadata = {
  title: "Your account",
  description: "Sign in to or create your Aaraj account.",
};

export default async function AccountPage() {
  const initialSession = await getInitialSession();

  if (initialSession) {
    const access = await getInitialAccess();
    if (access?.permissions.includes("catalog.manage")) {
      redirect("/admin");
    }
  }

  return <AuthPanel initialSession={initialSession} />;
}
