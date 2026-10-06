"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Permission } from "@aaraj/contracts";
import {
  Boxes,
  LayoutDashboard,
  Package,
  Ruler,
  Store,
  Tags,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { AdminUserMenu } from "@/features/admin/admin-user-menu";

const adminLinks = [
  {
    href: "/admin",
    label: "Overview",
    icon: LayoutDashboard,
    permission: "catalog.manage",
  },
  {
    href: "/admin/catalog",
    label: "Products",
    icon: Package,
    permission: "catalog.manage",
  },
  {
    href: "/admin/catalog/categories",
    label: "Categories",
    icon: Tags,
    permission: "catalog.categories.manage",
  },
  {
    href: "/admin/catalog/size-guides",
    label: "Size guides",
    icon: Ruler,
    permission: "catalog.manage",
  },
] as const;

const operationsLinks = [
  {
    href: "/admin/inventory",
    label: "Inventory",
    icon: Boxes,
    permission: "inventory.manage",
  },
] as const;

type AdminSidebarProps = {
  user: { name: string; email: string } | null;
  permissions: Permission[];
};

export function AdminSidebar({ user, permissions }: AdminSidebarProps) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const availableLinks = adminLinks.filter(({ permission }) =>
    permissions.includes(permission),
  );
  const availableOperationsLinks = operationsLinks.filter(({ permission }) =>
    permissions.includes(permission),
  );
  const activeHref = pathname
    ? [...adminLinks, ...operationsLinks].reduce<string | undefined>(
        (active, { href }) => {
          const matchesRoute =
            pathname === href || pathname.startsWith(`${href}/`);

          return matchesRoute && (!active || href.length > active.length)
            ? href
            : active;
        },
        undefined,
      )
    : undefined;
  const closeMobileSidebar = () => setOpenMobile(false);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href="/admin" onClick={closeMobileSidebar} />}
              tooltip="Aaraj administration"
            >
              <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
                A
              </span>
              <span className="grid text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="font-semibold">Aaraj</span>
                <span className="text-xs text-muted-foreground">
                  Administration
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {availableLinks.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Catalog</SidebarGroupLabel>
            <SidebarGroupContent>
              <nav aria-label="Administration">
                <SidebarMenu>
                  {availableLinks.map(({ href, label, icon: Icon }) => {
                    const isActive = activeHref === href;

                    return (
                      <SidebarMenuItem key={href}>
                        <SidebarMenuButton
                          isActive={isActive}
                          aria-current={pathname === href ? "page" : undefined}
                          render={
                            <Link href={href} onClick={closeMobileSidebar} />
                          }
                          tooltip={label}
                        >
                          <Icon aria-hidden="true" />
                          <span className="group-data-[collapsible=icon]:hidden">
                            {label}
                          </span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {availableOperationsLinks.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Operations</SidebarGroupLabel>
            <SidebarGroupContent>
              <nav aria-label="Operations">
                <SidebarMenu>
                  {availableOperationsLinks.map(
                    ({ href, label, icon: Icon }) => {
                      const isActive = activeHref === href;
                      return (
                        <SidebarMenuItem key={href}>
                          <SidebarMenuButton
                            isActive={isActive}
                            aria-current={
                              pathname === href ? "page" : undefined
                            }
                            render={
                              <Link href={href} onClick={closeMobileSidebar} />
                            }
                            tooltip={label}
                          >
                            <Icon aria-hidden="true" />
                            <span className="group-data-[collapsible=icon]:hidden">
                              {label}
                            </span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    },
                  )}
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/" onClick={closeMobileSidebar} />}
                  tooltip="View storefront"
                >
                  <Store aria-hidden="true" />
                  <span className="group-data-[collapsible=icon]:hidden">
                    View storefront
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <AdminUserMenu user={user} onNavigate={closeMobileSidebar} />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
