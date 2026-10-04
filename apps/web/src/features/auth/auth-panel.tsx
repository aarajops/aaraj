"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { authClient } from "@/features/auth/auth-client";
import type { InitialSession } from "@/features/auth/auth-session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type FormMode = "sign-in" | "sign-up";
type AuthForm = { name: string; email: string; password: string };

export function AuthPanel({
  initialSession,
}: {
  initialSession: InitialSession;
}) {
  authClient.hydrateSession(initialSession);
  const [mode, setMode] = useState<FormMode>("sign-in");
  const {
    register,
    handleSubmit,
    resetField,
    formState: { isSubmitting },
  } = useForm<AuthForm>({
    defaultValues: { name: "", email: "", password: "" },
  });
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

  async function submitCredentials({ name, email, password }: AuthForm) {
    setErrorMessage(null);
    setStatusMessage(null);

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
        resetField("password");
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
    <main className="flex min-h-[calc(100vh-4rem)] flex-1 items-center justify-center bg-background px-5 py-12 text-foreground">
      <Card
        aria-labelledby="account-heading"
        className="w-full max-w-md gap-0 rounded-2xl p-7 shadow-2xl sm:p-9"
        role="region"
      >
        <header className="mb-8">
          <p className="text-sm font-semibold tracking-[0.2em] text-primary">
            AARAJ
          </p>
          <h1
            className="mt-3 text-3xl font-semibold tracking-tight"
            id="account-heading"
          >
            Your account
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in or create an account with your email.
          </p>
        </header>

        {isSessionPending ? (
          <p className="text-sm text-muted-foreground" role="status">
            Checking your session…
          </p>
        ) : session?.user ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-border bg-background p-4">
              <p className="font-medium">Signed in as {session.user.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {session.user.email}
              </p>
            </div>
            <Button
              className="h-auto w-full px-4 py-3 text-base"
              variant="outline"
              type="button"
              onClick={handleSignOut}
            >
              Sign out
            </Button>
          </div>
        ) : (
          <>
            <div
              className="mb-6 grid grid-cols-2 rounded-lg bg-background p-1"
              aria-label="Account action"
            >
              {(["sign-in", "sign-up"] as const).map((option) => (
                <Button
                  key={option}
                  className="h-auto w-full px-3 py-2"
                  variant={mode === option ? "secondary" : "ghost"}
                  type="button"
                  aria-pressed={mode === option}
                  onClick={() => {
                    setMode(option);
                    setErrorMessage(null);
                    setStatusMessage(null);
                  }}
                >
                  {option === "sign-in" ? "Sign in" : "Create account"}
                </Button>
              ))}
            </div>

            <form
              className="space-y-4"
              onSubmit={handleSubmit(submitCredentials)}
            >
              {mode === "sign-up" && (
                <Field>
                  <FieldLabel htmlFor="name">Name</FieldLabel>
                  <Input
                    className="h-auto bg-background px-3 py-3 text-base md:text-base"
                    id="name"
                    autoComplete="name"
                    required
                    {...register("name", { required: mode === "sign-up" })}
                  />
                </Field>
              )}

              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  className="h-auto bg-background px-3 py-3 text-base md:text-base"
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  {...register("email", { required: true })}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  className="h-auto bg-background px-3 py-3 text-base md:text-base"
                  id="password"
                  type="password"
                  autoComplete={
                    mode === "sign-up" ? "new-password" : "current-password"
                  }
                  minLength={8}
                  maxLength={128}
                  required
                  {...register("password", {
                    required: true,
                    minLength: 8,
                    maxLength: 128,
                  })}
                />
                {mode === "sign-up" && (
                  <FieldDescription>
                    Use at least 8 characters.
                  </FieldDescription>
                )}
              </Field>

              <Button
                className="h-auto w-full px-4 py-3 text-base font-semibold"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? "Please wait…"
                  : mode === "sign-up"
                    ? "Create account"
                    : "Sign in"}
              </Button>
            </form>
          </>
        )}

        {(errorMessage || sessionError) && (
          <p
            className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            {errorMessage ?? sessionError?.message}
          </p>
        )}
        {statusMessage && (
          <p
            className="mt-5 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success"
            role="status"
          >
            {statusMessage}
          </p>
        )}
      </Card>
    </main>
  );
}
