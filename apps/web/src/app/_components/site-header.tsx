import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-5 px-5 py-4">
        <Link
          className="text-lg font-semibold tracking-[0.16em] text-primary"
          href="/"
        >
          AARAJ
        </Link>
        <nav aria-label="Main navigation" className="flex items-center gap-5">
          <Link
            className="text-sm text-muted-foreground hover:text-foreground"
            href="/"
          >
            Products
          </Link>
          <Link
            className="text-sm text-muted-foreground hover:text-foreground"
            href="/admin"
          >
            Admin
          </Link>
          <Link
            className="rounded-lg border border-input px-3 py-2 text-sm text-foreground hover:border-ring"
            href="/account"
          >
            Account
          </Link>
        </nav>
      </div>
    </header>
  );
}
