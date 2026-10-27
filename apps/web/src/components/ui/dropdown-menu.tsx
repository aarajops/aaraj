"use client";

import * as MenuPrimitive from "@base-ui/react/menu";
import Link from "next/link";
import { cn } from "cn";

const DropdownMenu = MenuPrimitive.Menu.Root;
const DropdownMenuGroup = MenuPrimitive.Menu.Group;

function DropdownMenuTrigger({
  className,
  ...props
}: MenuPrimitive.Menu.Trigger.Props) {
  return (
    <MenuPrimitive.Menu.Trigger
      data-slot="dropdown-menu-trigger"
      className={className}
      {...props}
    />
  );
}

function DropdownMenuContent({
  className,
  children,
  align = "end",
  side = "bottom",
  sideOffset = 4,
  ...props
}: MenuPrimitive.Menu.Popup.Props &
  Pick<MenuPrimitive.Menu.Positioner.Props, "align" | "side" | "sideOffset">) {
  return (
    <MenuPrimitive.Menu.Portal>
      <MenuPrimitive.Menu.Positioner
        align={align}
        className="z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Menu.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "max-h-[var(--available-height)] min-w-40 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none",
            className,
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Menu.Popup>
      </MenuPrimitive.Menu.Positioner>
    </MenuPrimitive.Menu.Portal>
  );
}

function DropdownMenuLabel({
  className,
  ...props
}: MenuPrimitive.Menu.GroupLabel.Props) {
  return (
    <MenuPrimitive.Menu.GroupLabel
      data-slot="dropdown-menu-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function DropdownMenuItem({
  className,
  ...props
}: MenuPrimitive.Menu.Item.Props) {
  return (
    <MenuPrimitive.Menu.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "relative flex min-h-8 w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

type DropdownMenuLinkItemProps = Omit<
  MenuPrimitive.Menu.LinkItem.Props,
  "href" | "render"
> & {
  href: Exclude<MenuPrimitive.Menu.LinkItem.Props["href"], undefined>;
};

function DropdownMenuLinkItem({
  className,
  href,
  ...props
}: DropdownMenuLinkItemProps) {
  return (
    <MenuPrimitive.Menu.LinkItem
      data-slot="dropdown-menu-item"
      href={href}
      className={cn(
        "relative flex min-h-8 w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      render={<Link href={href} prefetch={false} />}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
};
