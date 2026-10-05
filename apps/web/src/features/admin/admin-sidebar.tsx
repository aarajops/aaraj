"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Package, Ruler, Store, Tags } from "lucide-react";
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
} from "@/components/ui/sidebar";
import { AdminUserMenu } from "@/features/admin/admin-user-menu";

const adminLinks = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/catalog", label: "Products", icon: Package },
  {
    href: "/admin/catalog/categories",
    label: "Categories",
    icon: Tags,
  },
  {
    href: "/admin/catalog/size-guides",
    label: "Size guides",
    icon: Ruler,
  },
] as const;

type AdminSidebarProps = {
  user: { name: string; email: string } | null;
};

export function AdminSidebar({ user }: AdminSidebarProps) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href="/admin" />}
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
        <SidebarGroup>
          <SidebarGroupLabel>Catalog</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminLinks.map(({ href, label, icon: Icon }) => {
                const isActive = pathname === href;

                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      isActive={isActive}
                      aria-current={isActive ? "page" : undefined}
                      render={<Link href={href} />}
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
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<Link href="/" />}
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
          <AdminUserMenu user={user} />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
