"use client";

import { useLinkStatus } from "next/link";

export function ProductLinkStatus() {
  const { pending } = useLinkStatus();

  return (
    <>
      <span
        aria-hidden="true"
        className={`mt-2 text-xs text-muted-foreground transition-opacity ${pending ? "opacity-100" : "opacity-0"}`}
      >
        Opening product…
      </span>
      <span aria-live="polite" className="sr-only">
        {pending ? "Loading product details" : ""}
      </span>
    </>
  );
}
