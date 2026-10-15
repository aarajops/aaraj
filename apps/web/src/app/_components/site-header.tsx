import Image from "next/image";
import Link from "next/link";
import { CartBadge } from "@/features/cart/cart-badge";
import { getPublicStorefrontSettings } from "@/features/storefront/storefront-settings";

export async function SiteHeader() {
  const settings = await getPublicStorefrontSettings();

  return (
    <>
      {settings.announcementEnabled && settings.announcementText && (
        <aside
          aria-label="Store announcement"
          className="bg-neutral-950 px-4 py-2 text-center text-xs font-semibold tracking-wide text-white"
        >
          {settings.announcementText}
        </aside>
      )}
      <header className="border-b border-border bg-background text-foreground">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-5 px-5 py-4">
          <Link
            aria-label={`${settings.siteName} home`}
            className="inline-flex min-h-10 items-center text-lg font-semibold tracking-[0.16em] text-primary"
            href="/"
          >
            <Image
              alt={`${settings.siteName} logo`}
              className="h-auto max-h-10 w-auto max-w-44 object-contain"
              height={settings.logo?.height ?? 156}
              src={settings.logo?.src ?? "/aaraj-logo.svg"}
              unoptimized
              width={settings.logo?.width ?? 512}
            />
          </Link>
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-3 sm:gap-5"
          >
            {settings.supportPhone && (
              <a
                className="text-sm text-muted-foreground hover:text-foreground"
                href={`tel:${settings.supportPhone}`}
              >
                Call us: {settings.supportPhone}
              </a>
            )}
            <Link
              className="text-sm text-muted-foreground hover:text-foreground"
              href="/"
            >
              Products
            </Link>
            <CartBadge />
            <Link
              className="rounded-lg border border-input px-3 py-2 text-sm text-foreground hover:border-ring"
              href="/account"
            >
              Account
            </Link>
          </nav>
        </div>
      </header>
    </>
  );
}
