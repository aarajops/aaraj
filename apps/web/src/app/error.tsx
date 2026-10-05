"use client";

import { useEffect } from "react";
import { AppErrorContent } from "@/app/_components/app-error-content";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <AppErrorContent retry={retry} />;
}
