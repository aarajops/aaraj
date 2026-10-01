import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-5 px-5 py-4">
        <Link
          className="text-lg font-semibold tracking-[0.16em] text-emerald-300"
          href="/"
        >
          AARAJ
        </Link>
        <nav aria-label="Main navigation" className="flex items-center gap-5">
          <Link className="text-sm text-zinc-300 hover:text-white" href="/">
            Products
          </Link>
          <Link
            className="text-sm text-zinc-300 hover:text-white"
            href="/staff/catalog"
          >
            Staff catalog
          </Link>
          <Link
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-500 hover:text-white"
            href="/account"
          >
            Account
          </Link>
        </nav>
      </div>
    </header>
  );
}
