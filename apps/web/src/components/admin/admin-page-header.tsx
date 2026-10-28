import type { ReactNode } from "react";

type AdminPageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  backLink?: ReactNode;
  actions?: ReactNode;
};

export const adminPageLinkClassName =
  "inline-flex min-h-9 items-center rounded-md text-sm text-primary hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-foreground";

export function AdminPageHeader({
  title,
  description,
  backLink,
  actions,
}: AdminPageHeaderProps) {
  return (
    <div className="space-y-4">
      {backLink && <div>{backLink}</div>}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:justify-end">
            {actions}
          </div>
        )}
      </header>
    </div>
  );
}
