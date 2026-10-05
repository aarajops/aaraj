import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] flex-1 items-center justify-center bg-background px-5 py-14 text-foreground">
      <section className="max-w-lg text-center">
        <p className="text-sm font-semibold tracking-[0.18em] text-primary">
          404
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p className="mt-3 text-secondary-foreground">
          This page may have moved or is no longer available.
        </p>
        <Link
          className="mt-6 inline-flex rounded-lg bg-primary px-4 py-2.5 font-semibold text-primary-foreground hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          href="/"
        >
          Back to products
        </Link>
      </section>
    </main>
  );
}
