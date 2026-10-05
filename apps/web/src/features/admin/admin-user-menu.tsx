"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EllipsisVertical, LogOut, UserRound } from "lucide-react";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { authClient } from "@/features/auth/auth-client";

type AdminUserMenuProps = {
  user: { name: string; email: string } | null;
};

export function AdminUserMenu({ user }: AdminUserMenuProps) {
  const router = useRouter();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const displayName = user?.name.trim() || user?.email || "Account";
  const initials = displayName
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      const details = detailsRef.current;
      if (
        details?.open &&
        event.target instanceof Node &&
        !details.contains(event.target)
      ) {
        details.open = false;
        setIsOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      const details = detailsRef.current;
      if (event.key !== "Escape" || !details?.open) return;

      event.preventDefault();
      details.open = false;
      setIsOpen(false);
      details.querySelector("summary")?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  async function handleSignOut() {
    setSignOutError(null);
    setIsSigningOut(true);

    try {
      const result = await authClient.signOut();
      if (result.error) {
        setSignOutError(
          result.error.message ?? "Could not sign out. Try again.",
        );
        return;
      }

      if (detailsRef.current) detailsRef.current.open = false;
      setIsOpen(false);
      router.replace("/account");
      router.refresh();
    } catch {
      setSignOutError(
        "Could not sign out. Check your connection and try again.",
      );
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <SidebarMenuItem>
      <details
        ref={detailsRef}
        className="relative"
        onToggle={(event) => {
          setIsOpen(event.currentTarget.open);
          if (event.currentTarget.open) setSignOutError(null);
        }}
      >
        <summary
          aria-controls="admin-user-menu"
          aria-expanded={isOpen}
          aria-label={`Account menu for ${displayName}`}
          className="flex min-h-12 w-full cursor-pointer list-none items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&::-webkit-details-marker]:hidden"
        >
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
          >
            {initials || "A"}
          </span>
          <span className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate font-medium">{displayName}</span>
            <span className="truncate text-xs text-muted-foreground">
              {user?.email ?? "Sign in to manage your account"}
            </span>
          </span>
          <EllipsisVertical
            aria-hidden="true"
            className="size-4 shrink-0 group-data-[collapsible=icon]:hidden"
          />
        </summary>

        <div
          className="absolute bottom-full left-0 z-50 mb-2 w-full min-w-56 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg md:bottom-0 md:left-full md:mb-0 md:ml-2 md:w-60"
          hidden={!isOpen}
          id="admin-user-menu"
        >
          <div className="flex items-center gap-2 border-b border-border p-3">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
            >
              {initials || "A"}
            </span>
            <span className="grid min-w-0 leading-tight">
              <span className="truncate text-sm font-medium">
                {displayName}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {user?.email ?? "Sign in to manage your account"}
              </span>
            </span>
          </div>

          <div className="p-1">
            <Link
              className="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
              href="/account"
            >
              <UserRound aria-hidden="true" className="size-4" />
              Account
            </Link>
            {user && (
              <button
                className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                disabled={isSigningOut}
                onClick={handleSignOut}
                type="button"
              >
                <LogOut aria-hidden="true" className="size-4" />
                {isSigningOut ? "Signing out…" : "Log out"}
              </button>
            )}
          </div>
          {signOutError && (
            <p
              className="border-t border-border px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {signOutError}
            </p>
          )}
        </div>
      </details>
    </SidebarMenuItem>
  );
}
