import { cn } from "cn";

const aspectRatioClasses = {
  landscape: "aspect-[4/3]",
  portrait: "aspect-[4/5]",
  square: "aspect-square",
} as const;

function AspectRatio({
  ratio,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  ratio: keyof typeof aspectRatioClasses;
}) {
  return (
    <div
      data-slot="aspect-ratio"
      className={cn("relative", aspectRatioClasses[ratio], className)}
      {...props}
    />
  );
}

export { AspectRatio };
