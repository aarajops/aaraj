import type { Metadata } from "next";
import { AuthPanel } from "@/features/auth/auth-panel";
import { getInitialSession } from "@/features/auth/auth-session";

export const metadata: Metadata = {
  title: "Aaraj | Your account",
  description: "Sign in to or create your Aaraj account.",
};

export default async function AccountPage() {
  const initialSession = await getInitialSession();
  return <AuthPanel initialSession={initialSession} />;
}
