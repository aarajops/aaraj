import Link from "next/link";
import { Phone } from "lucide-react";
import { Suspense } from "react";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { MobileStorefrontControls } from "./mobile-storefront-controls";
import { getPublishedProductFilterOptions } from "@/features/catalog/catalog-queries";
import { StorefrontSearchBar } from "@/features/catalog/storefront-search-bar";
import { StorefrontBrandLogo } from "@/features/storefront/storefront-brand-logo";
import { getPublicStorefrontSettings } from "@/features/storefront/storefront-settings";

export async function SiteHeader() {
  const [settings, productFilters] = await Promise.all([
    getPublicStorefrontSettings(),
    getPublishedProductFilterOptions(),
  ]);
  const headerNavigation = settings.headerNavigation;

  return (
    <>
      {settings.announcementEnabled && settings.announcementText && (
        <aside
          aria-label="Store announcement"
          className="bg-foreground px-4 py-2.5 text-center text-xs font-semibold tracking-wide text-white"
        >
          {settings.announcementText}
        </aside>
      )}
      <header>
        <div className="container mx-auto px-2 lg:px-0">
          <nav
            aria-label="Store utility navigation"
            className="hidden h-10 items-center justify-end gap-5 text-xs text-muted-foreground xl:flex"
          >
            <Link className="hover:text-foreground" href="/account">
              Log In
            </Link>
            {settings.supportPhone && (
              <a
                className="inline-flex items-center gap-2 whitespace-nowrap font-medium hover:text-foreground"
                href={`tel:${settings.supportPhone}`}
              >
                <Phone aria-hidden="true" className="size-3.5" />
                <span>Call Us: {settings.supportPhone}</span>
              </a>
            )}
          </nav>

          <div className="relative flex flex-wrap items-center justify-between gap-x-2 gap-y-2 xl:grid xl:grid-cols-3 xl:gap-0 2xl:grid-cols-4">
            <MobileStorefrontControls
              categories={productFilters?.categories ?? []}
              headerNavigation={headerNavigation}
              siteName={settings.siteName}
              supportPhone={settings.supportPhone}
            />

            <div className="absolute top-2 left-1/2 -translate-x-1/2 xl:static xl:col-start-1 xl:row-start-1 xl:translate-x-0 xl:justify-self-start">
              <StorefrontBrandLogo
                imageClassName="h-10 max-w-44 xl:h-14 xl:max-w-64"
                logo={settings.logo}
                loading="eager"
                siteName={settings.siteName}
              />
            </div>

            <Suspense
              fallback={
                <Skeleton
                  aria-hidden="true"
                  className="hidden h-8 min-w-0 rounded-full xl:col-start-2 xl:row-start-1 xl:flex xl:w-112 xl:justify-self-center 2xl:col-span-2 2xl:h-10 2xl:w-144"
                />
              }
            >
              <StorefrontSearchBar
                categories={productFilters?.categories ?? []}
                className="hidden xl:col-start-2 xl:row-start-1 xl:flex xl:w-112 xl:justify-self-center 2xl:col-span-2 2xl:w-144"
              />
            </Suspense>
          </div>

          {headerNavigation.length > 0 && (
            <nav
              aria-label="Main navigation"
              className="border-t border-brand/10 hidden overflow-x-auto xl:flex xl:justify-center"
            >
              <NavigationMenu className="max-w-none flex-none">
                <NavigationMenuList className="flex-none gap-4">
                  {headerNavigation.map(({ href, label }, index) => (
                    <NavigationMenuItem
                      className="flex-none"
                      key={`link:${index}:${label}:${href}`}
                    >
                      <NavigationMenuLink
                        className={`${navigationMenuTriggerStyle()} h-auto rounded-none bg-transparent px-3 py-2 uppercase tracking-wide text-foreground hover:bg-transparent hover:text-primary focus:bg-transparent data-active:bg-transparent`}
                        render={
                          href.startsWith("/") ? (
                            <Link href={href} />
                          ) : (
                            <a
                              href={href}
                              rel="noopener noreferrer"
                              target="_blank"
                            />
                          )
                        }
                      >
                        {label}
                      </NavigationMenuLink>
                    </NavigationMenuItem>
                  ))}
                </NavigationMenuList>
              </NavigationMenu>
            </nav>
          )}
        </div>
      </header>
    </>
  );
}
