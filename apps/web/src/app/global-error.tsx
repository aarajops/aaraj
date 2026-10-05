"use client";

import { useEffect } from "react";
import "./globals.css";
import { AppErrorContent } from "@/app/_components/app-error-content";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-background text-foreground">
        <title>Aaraj | Error</title>
        <AppErrorContent retry={retry} />
      </body>
    </html>
  );
}
