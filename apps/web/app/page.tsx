import { AuthPanel } from "@/app/auth-panel";
import { getInitialSession } from "@/lib/auth-session";

export default async function Home() {
  const initialSession = await getInitialSession();
  return <AuthPanel initialSession={initialSession} />;
}
