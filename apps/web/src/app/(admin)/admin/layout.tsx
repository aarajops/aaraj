import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  getInitialAccess,
  getInitialSession,
} from "@/features/auth/auth-session";
import { AdminSidebar } from "@/features/admin/admin-sidebar";

export default async function AdminLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const [session, access] = await Promise.all([
    getInitialSession(),
    getInitialAccess(),
  ]);
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AdminSidebar
          permissions={access?.permissions ?? []}
          user={
            session?.user
              ? { name: session.user.name, email: session.user.email }
              : null
          }
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <p className="text-sm font-medium text-foreground">
              Administration
            </p>
          </header>
          {children}
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
