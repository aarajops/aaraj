import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

type HeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
type HeadingVariant = "page" | "section" | "subsection" | "compact";

const variants: Record<HeadingVariant, string> = {
  page: "text-3xl font-bold tracking-tight sm:text-4xl",
  section:
    "text-center text-2xl font-bold uppercase tracking-tight sm:text-3xl",
  subsection: "text-xl font-bold tracking-tight sm:text-2xl",
  compact: "text-sm font-bold",
};

type HeadingProps = ComponentPropsWithoutRef<"h2"> & {
  as?: HeadingLevel;
  variant?: HeadingVariant;
};

export function Heading({
  as: Tag = "h2",
  variant = "section",
  className,
  ...props
}: HeadingProps) {
  return (
    <Tag
      className={cn("text-foreground", variants[variant], className)}
      {...props}
    />
  );
}
