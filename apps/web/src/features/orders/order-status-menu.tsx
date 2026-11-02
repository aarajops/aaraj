"use client";

import { ChevronDown } from "lucide-react";
import type { OrderStatusAction } from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const actionLabels: Record<OrderStatusAction, string> = {
  confirmed: "Confirm",
  no_answer: "No Answer",
  on_hold: "Hold",
  cancelled: "Cancel",
  pending: "Reopen",
};

export function OrderStatusMenu({
  actions,
  disabled = false,
  onSelect,
}: {
  actions: OrderStatusAction[];
  disabled?: boolean;
  onSelect: (action: OrderStatusAction) => void;
}) {
  if (actions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={<Button size="sm" type="button" variant="outline" />}
      >
        Update status
        <ChevronDown aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {actions.map((action) => (
          <DropdownMenuItem
            className={
              action === "cancelled"
                ? "text-destructive data-highlighted:bg-destructive/10 data-highlighted:text-destructive"
                : undefined
            }
            disabled={disabled}
            key={action}
            onClick={() => onSelect(action)}
          >
            {actionLabels[action]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
