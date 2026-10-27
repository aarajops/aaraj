"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OrderInvoicePrintButton({
  autoPrint = false,
}: {
  autoPrint?: boolean;
}) {
  useEffect(() => {
    if (!autoPrint) return;

    const frame = window.requestAnimationFrame(() => window.print());
    return () => window.cancelAnimationFrame(frame);
  }, [autoPrint]);

  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      <Printer aria-hidden="true" />
      Print invoice
    </Button>
  );
}
