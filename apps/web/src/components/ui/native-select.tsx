import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";

function NativeSelect({
  className,
  ...props
}: Omit<React.ComponentProps<"select">, "size">) {
  return (
    <div className="relative w-full" data-slot="native-select-wrapper">
      <select
        data-slot="native-select"
        className={cn(
          "h-10 w-full appearance-none rounded-lg border border-input bg-background px-3 pr-9 text-base text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm",
          className,
        )}
        {...props}
      />
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export { NativeSelect };
