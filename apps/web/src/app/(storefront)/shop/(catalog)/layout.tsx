import type { ReactNode } from "react";

export default function CatalogLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <main className="flex-1 bg-background px-5 pt-3 pb-10 text-foreground">
      <div className="container mx-auto">{children}</div>
    </main>
  );
}
