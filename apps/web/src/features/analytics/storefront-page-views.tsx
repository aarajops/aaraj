"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { sendPageView } from "./gtm-ecommerce";

export function StorefrontPageViews() {
  const pathname = usePathname();
  const previousPathname = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || previousPathname.current === pathname) return;
    if (sendPageView(pathname)) previousPathname.current = pathname;
  }, [pathname]);

  return null;
}
