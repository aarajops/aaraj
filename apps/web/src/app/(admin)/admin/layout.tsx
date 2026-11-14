import type { ReactNode } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  getInitialAccess,
  getInitialSession,
} from "@/features/auth/auth-session";
import { AdminSidebar } from "@/features/admin/admin-sidebar";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

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
      <SidebarProvider
        className="print:block print:min-h-0 print:w-full print:bg-white"
        defaultOpen={defaultOpen}
      >
        <AdminSidebar
          permissions={access?.permissions ?? []}
          user={
            session?.user
              ? { name: session.user.name, email: session.user.email }
              : null
          }
        />
        <SidebarInset className="min-w-0 print:block print:min-h-0 print:w-full print:bg-white">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 print:hidden">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <p className="text-sm font-medium text-foreground">
              Administration
            </p>
          </header>
          <div className="min-w-0 flex-1 bg-background p-4 text-foreground sm:p-6 lg:p-8 print:block print:min-h-0 print:w-full print:bg-white print:p-0 print:text-black">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
