import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getInitialSession } from "@/features/auth/auth-session";
import { AdminSidebar } from "@/features/admin/admin-sidebar";

export default async function AdminLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const session = await getInitialSession();

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AdminSidebar
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
