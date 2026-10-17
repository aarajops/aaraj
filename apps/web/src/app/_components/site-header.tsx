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
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-5 px-3 py-4 lg:px-0">
          <Link
            aria-label={`${settings.siteName} home`}
            className="inline-flex min-h-10 items-center text-lg font-semibold tracking-[0.16em] text-primary"
            href="/"
          >
            <Image
              alt={`${settings.siteName} logo`}
              className="h-10 w-auto max-w-44 object-contain"
              height={settings.logo?.height ?? 156}
              src={settings.logo?.src ?? "/aaraj-logo.svg"}
              unoptimized
              width={settings.logo?.width ?? 512}
            />
          </Link>
          <nav
            aria-label="Main navigation"
            className="flex flex-wrap items-center justify-end gap-3 sm:gap-5"
          >
            <ul className="flex flex-wrap items-center gap-3 sm:gap-5">
              {settings.headerNavigation.map(({ href, label }, index) => (
                <li key={`link:${index}:${label}:${href}`}>
                  {href.startsWith("/") ? (
                    <Link
                      className="text-sm text-muted-foreground hover:text-foreground"
                      href={href}
                    >
                      {label}
                    </Link>
                  ) : (
                    <a
                      className="text-sm text-muted-foreground hover:text-foreground"
                      href={href}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {settings.supportPhone && (
              <a
                className="text-sm text-muted-foreground hover:text-foreground"
                href={`tel:${settings.supportPhone}`}
              >
                Call us: {settings.supportPhone}
              </a>
            )}
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
