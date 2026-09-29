"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import type { InitialSession } from "@/lib/auth-session";

type FormMode = "sign-in" | "sign-up";

export function AuthPanel({
  initialSession,
}: {
  initialSession: InitialSession;
}) {
  authClient.hydrateSession(initialSession);
  const [mode, setMode] = useState<FormMode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const {
    data,
    isPending,
    isRefetching,
    error: sessionError,
  } = authClient.useSession();
  const session = isPending && !isRefetching ? initialSession : data;
  const isSessionPending = isPending && !isRefetching && !initialSession;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    setIsSubmitting(true);

    let rateLimited = false;
    const onError = ({ response }: { response: Response }) => {
      if (response.status !== 429) return;

      rateLimited = true;
      const retryAfter = response.headers.get("X-Retry-After");
      setErrorMessage(
        retryAfter
          ? `Too many attempts. Try again in ${retryAfter} seconds.`
          : "Too many attempts. Please wait and try again.",
      );
    };

    try {
      const result =
        mode === "sign-up"
          ? await authClient.signUp.email(
              { name, email, password },
              { onError },
            )
          : await authClient.signIn.email({ email, password }, { onError });

      if (result.error) {
        if (!rateLimited) {
          setErrorMessage(result.error.message ?? "Authentication failed.");
        }
      } else {
        setPassword("");
        setStatusMessage(
          mode === "sign-up"
            ? "Your Aaraj account is ready."
            : "You are signed in.",
        );
      }
    } catch {
      setErrorMessage(
        "Could not reach the server. Check that the API is running and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const result = await authClient.signOut();
      if (result.error) {
        setErrorMessage(result.error.message ?? "Could not sign out.");
      } else {
        setStatusMessage("You are signed out.");
      }
    } catch {
      setErrorMessage(
        "Could not sign out. Check your connection and try again.",
      );
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-5 py-12 text-zinc-100">
      <section className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-7 shadow-2xl sm:p-9">
        <header className="mb-8">
          <p className="text-sm font-semibold tracking-[0.2em] text-emerald-400">
            AARAJ
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Your account
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Sign in or create an account with your email.
          </p>
        </header>

        {isSessionPending ? (
          <p className="text-sm text-zinc-400" role="status">
            Checking your session…
          </p>
        ) : session?.user ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="font-medium">Signed in as {session.user.name}</p>
              <p className="mt-1 text-sm text-zinc-400">{session.user.email}</p>
            </div>
            <button
              className="w-full rounded-lg bg-white px-4 py-3 font-medium text-zinc-900 transition hover:bg-zinc-200 disabled:opacity-60"
              type="button"
              onClick={handleSignOut}
            >
              Sign out
            </button>
          </div>
        ) : (
          <>
            <div
              className="mb-6 grid grid-cols-2 rounded-lg bg-zinc-950 p-1"
              aria-label="Account action"
            >
              {(["sign-in", "sign-up"] as const).map((option) => (
                <button
                  key={option}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition ${mode === option ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white"}`}
                  type="button"
                  aria-pressed={mode === option}
                  onClick={() => {
                    setMode(option);
                    setErrorMessage(null);
                    setStatusMessage(null);
                  }}
                >
                  {option === "sign-in" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              {mode === "sign-up" && (
                <label
                  className="block space-y-2 text-sm font-medium"
                  htmlFor="name"
                >
                  Name
                  <input
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-base outline-none transition placeholder:text-zinc-600 focus:border-emerald-400"
                    id="name"
                    name="name"
                    autoComplete="name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              )}

              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="email"
              >
                Email
                <input
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-base outline-none transition placeholder:text-zinc-600 focus:border-emerald-400"
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>

              <label
                className="block space-y-2 text-sm font-medium"
                htmlFor="password"
              >
                Password
                <input
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 text-base outline-none transition placeholder:text-zinc-600 focus:border-emerald-400"
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={
                    mode === "sign-up" ? "new-password" : "current-password"
                  }
                  minLength={8}
                  maxLength={128}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>

              <button
                className="w-full rounded-lg bg-emerald-400 px-4 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? "Please wait…"
                  : mode === "sign-up"
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>
          </>
        )}

        {(errorMessage || sessionError) && (
          <p
            className="mt-5 rounded-lg border border-red-900 bg-red-950/60 p-3 text-sm text-red-200"
            role="alert"
          >
            {errorMessage ?? sessionError?.message}
          </p>
        )}
        {statusMessage && (
          <p
            className="mt-5 rounded-lg border border-emerald-900 bg-emerald-950/60 p-3 text-sm text-emerald-200"
            role="status"
          >
            {statusMessage}
          </p>
        )}
      </section>
    </main>
  );
}
