"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { API_V1_BASE_PATH, EffectiveAccessSchema } from "@aaraj/contracts";
import { authClient } from "@/features/auth/auth-client";
import type { InitialSession } from "@/features/auth/auth-session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CartRequestError } from "@/features/cart/cart-client";
import { useCartStore } from "@/features/cart/cart-provider";

type FormMode = "sign-in" | "sign-up";
type AuthForm = { name: string; email: string; password: string };

export function AuthPanel({
  initialSession,
}: {
  initialSession: InitialSession;
}) {
  const router = useRouter();
  const mergeCart = useCartStore((state) => state.merge);
  const refreshCart = useCartStore((state) => state.refresh);
  authClient.hydrateSession(initialSession);
  const [mode, setMode] = useState<FormMode>("sign-in");
  const [showPassword, setShowPassword] = useState(false);
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
  const visibleErrorMessage =
    errorMessage?.trim() || sessionError?.message?.trim() || null;

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
        setShowPassword(false);
        setStatusMessage("Signed in. Redirecting…");

        let cartDestination: string | null = null;
        try {
          const merge = await mergeCart();
          if (merge.guestCartCleanupPending)
            cartDestination = "/cart?merge=cleanup";
        } catch (error) {
          const code =
            error instanceof CartRequestError ? error.errorCode : null;
          cartDestination =
            code === "CART_LIMIT_EXCEEDED" ||
            code === "CART_VARIANT_UNAVAILABLE"
              ? "/cart?merge=required"
              : "/cart?merge=retry";
        }

        let destination = "/";
        try {
          const response = await fetch(`${API_V1_BASE_PATH}/access/me`, {
            cache: "no-store",
          });
          if (response.ok) {
            const access = EffectiveAccessSchema.safeParse(
              await response.json(),
            );
            if (
              access.success &&
              access.data.permissions.includes("catalog.manage")
            ) {
              destination = "/admin";
            }
          }
        } catch {
          // If access cannot be confirmed, keep navigation on the public storefront.
        }

        router.replace(cartDestination ?? destination);
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
        await refreshCart();
      }
    } catch {
      setErrorMessage(
        "Could not sign out. Check your connection and try again.",
      );
    }
  }

  const credentialsForm = (
    <form className="space-y-4" onSubmit={handleSubmit(submitCredentials)}>
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
        <InputGroup className="h-auto bg-background">
          <InputGroupInput
            className="h-auto px-3 py-3 text-base md:text-base"
            id="password"
            type={showPassword ? "text" : "password"}
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
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label={showPassword ? "Hide password" : "Show password"}
              size="icon-sm"
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {showPassword ? (
                <EyeOff aria-hidden="true" />
              ) : (
                <Eye aria-hidden="true" />
              )}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {mode === "sign-up" && (
          <FieldDescription>Use at least 8 characters.</FieldDescription>
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
  );

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
          <div aria-busy="true" className="space-y-6" role="status">
            <span className="sr-only">Checking your session…</span>
            <div
              aria-hidden="true"
              className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
            >
              <Skeleton className="h-8 rounded-md bg-background shadow-sm" />
              <Skeleton className="h-8 rounded-md bg-muted-foreground/10" />
            </div>
            <div aria-hidden="true" className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-12 w-full rounded-lg" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-12 w-full rounded-lg" />
              </div>
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          </div>
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
          <Tabs
            className="gap-0"
            value={mode}
            onValueChange={(value) => {
              if (value !== "sign-in" && value !== "sign-up") return;

              setMode(value);
              setShowPassword(false);
              setErrorMessage(null);
              setStatusMessage(null);
            }}
          >
            <TabsList
              className="mb-6 grid w-full grid-cols-2 group-data-horizontal/tabs:h-10"
              aria-label="Account action"
            >
              <TabsTrigger value="sign-in">Sign in</TabsTrigger>
              <TabsTrigger value="sign-up">Create account</TabsTrigger>
            </TabsList>
            <TabsContent value="sign-in">
              {mode === "sign-in" && credentialsForm}
            </TabsContent>
            <TabsContent value="sign-up">
              {mode === "sign-up" && credentialsForm}
            </TabsContent>
          </Tabs>
        )}

        {visibleErrorMessage && (
          <p
            className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            {visibleErrorMessage}
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
