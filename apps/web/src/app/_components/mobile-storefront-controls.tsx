"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { Menu, Phone, Search } from "lucide-react";
import type {
  CatalogCategoryOption,
  PublicStorefrontSettings,
} from "@aaraj/contracts";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { CartSheet } from "@/features/cart/cart-sheet";
import { StorefrontSearchBar } from "@/features/catalog/storefront-search-bar";

type MobileStorefrontControlsProps = {
  categories: CatalogCategoryOption[];
  headerNavigation: PublicStorefrontSettings["headerNavigation"];
  siteName: string;
  supportPhone: string | null;
};

export function MobileStorefrontControls({
  categories,
  headerNavigation,
  siteName,
  supportPhone,
}: MobileStorefrontControlsProps) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <Sheet>
        <SheetTrigger
          aria-label="Open navigation menu"
          className={buttonVariants({
            className: "col-start-1 row-start-1 xl:hidden",
            size: "icon",
            variant: "ghost",
          })}
        >
          <Menu aria-hidden="true" />
        </SheetTrigger>

        <SheetContent className="gap-0 overflow-y-auto" side="left">
          <SheetHeader className="border-b border-border p-6 pr-14">
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription>
              Browse {siteName} and manage your account.
            </SheetDescription>
          </SheetHeader>

          <nav aria-label="Mobile main navigation" className="p-4">
            <ul className="grid gap-1">
              {headerNavigation.map(({ href, label }, index) => (
                <li key={`${index}:${label}:${href}`}>
                  <SheetClose
                    className="block rounded-md px-3 py-3 text-sm font-medium text-foreground hover:bg-muted"
                    nativeButton={false}
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
                  </SheetClose>
                </li>
              ))}
            </ul>
          </nav>

          <SheetFooter className="items-start border-t border-border p-4">
            <SheetClose
              className="rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              nativeButton={false}
              render={<Link href="/account" />}
            >
              Log In
            </SheetClose>
            {supportPhone && (
              <SheetClose
                className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                nativeButton={false}
                render={<a href={`tel:${supportPhone}`} />}
              >
                <Phone aria-hidden="true" className="size-4" />
                Call Us: {supportPhone}
              </SheetClose>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <div className="col-start-3 row-start-1 flex items-center justify-self-end gap-1 xl:col-start-3 xl:gap-5 2xl:col-start-4">
        <CartSheet />
        <Button
          aria-controls="mobile-storefront-search"
          aria-expanded={searchOpen}
          aria-label={searchOpen ? "Close search" : "Open search"}
          className="xl:hidden"
          onClick={() => setSearchOpen((open) => !open)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Search aria-hidden="true" />
        </Button>
      </div>

      <div
        className="order-last basis-full min-w-0 pb-2 xl:hidden"
        hidden={!searchOpen}
        id="mobile-storefront-search"
      >
        <Suspense
          fallback={
            <div aria-hidden="true" className="h-12 rounded-full bg-muted" />
          }
        >
          <StorefrontSearchBar categories={categories} className="w-full" />
        </Suspense>
      </div>
    </>
  );
}
