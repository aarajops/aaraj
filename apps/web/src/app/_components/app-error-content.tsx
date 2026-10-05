"use client";

export function AppErrorContent({ retry }: { retry: () => void }) {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] flex-1 items-center justify-center bg-background px-5 py-14 text-foreground">
      <section
        aria-labelledby="app-error-heading"
        className="max-w-lg text-center"
        role="alert"
      >
        <h1
          className="text-3xl font-semibold tracking-tight"
          id="app-error-heading"
        >
          Something went wrong
        </h1>
        <p className="mt-3 text-secondary-foreground">
          Please try loading this page again.
        </p>
        <button
          className="mt-6 inline-flex rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={retry}
          type="button"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
