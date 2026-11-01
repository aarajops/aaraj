"use client";

import { ChevronDown } from "lucide-react";
import type { Order, OrderStatusAction } from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type OrderStatusMenuAction = Exclude<OrderStatusAction, "rejected">;

export function OrderStatusMenu({
  actions,
  disabled = false,
  onSelect,
  status,
}: {
  actions: OrderStatusAction[];
  disabled?: boolean;
  onSelect: (action: OrderStatusMenuAction) => void;
  status: Order["status"];
}) {
  const availableActions = actions.filter(
    (action): action is OrderStatusMenuAction => action !== "rejected",
  );

  if (availableActions.length === 0) return null;

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
        {availableActions.map((action) => (
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
            {action === "confirmed"
              ? status === "on_hold"
                ? "Confirm and resume"
                : "Confirm order"
              : action === "pending"
                ? "Reopen as pending"
                : action === "on_hold"
                  ? "Put on hold"
                  : action === "cancelled"
                    ? "Cancel order"
                    : "Mark no answer"}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
