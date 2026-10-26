"use client";

import { useState, type ReactNode } from "react";
import { Columns2, Columns3, Columns4 } from "lucide-react";
import { Button } from "@/components/ui/button";

const columnClasses = {
  2: "grid-cols-2",
  3: "grid-cols-2 md:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-3 2xl:grid-cols-4",
} as const;

const columnOptions = [
  { count: 2, Icon: Columns2 },
  { count: 3, Icon: Columns3 },
  { count: 4, Icon: Columns4 },
] as const;

type ColumnCount = keyof typeof columnClasses;

export function CatalogProductGrid({
  toolbar,
  children,
}: {
  toolbar: ReactNode;
  children: ReactNode;
}) {
  const [columns, setColumns] = useState<ColumnCount>(4);

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-4">
        <div
          aria-label="Maximum product grid columns"
          className="hidden items-center gap-1 lg:flex"
          role="group"
        >
          {columnOptions.map(({ count, Icon }) => (
            <Button
              key={count}
              aria-label={`Show up to ${count} columns`}
              aria-pressed={columns === count}
              onClick={() => setColumns(count)}
              size="icon-lg"
              type="button"
              variant={columns === count ? "secondary" : "ghost"}
            >
              <Icon aria-hidden="true" />
            </Button>
          ))}
        </div>
        <div className="w-full min-w-0 lg:w-auto">{toolbar}</div>
      </div>
      <ul
        className={`mt-5 grid gap-x-3 gap-y-8 sm:gap-x-4 lg:gap-x-5 ${columnClasses[columns]}`}
      >
        {children}
      </ul>
    </>
  );
}
