"use client";

import { useLinkStatus } from "next/link";

export function ProductLinkStatus() {
  const { pending } = useLinkStatus();

  return (
    <span aria-live="polite" className="sr-only">
      {pending ? "Opening product" : ""}
    </span>
  );
}
