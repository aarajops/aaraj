"use client";

import { lazy, Suspense, useEffect, useState } from "react";

const Snowfall = lazy(() => import("react-snowfall"));

export function HomepageSnowfall() {
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [snowflakeImage, setSnowflakeImage] = useState<HTMLImageElement | null>(
    null,
  );

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setMotionAllowed(!preference.matches);

    updatePreference();
    preference.addEventListener("change", updatePreference);

    return () => preference.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (!motionAllowed || snowflakeImage) return;

    const image = new window.Image();
    image.onload = () => setSnowflakeImage(image);
    image.src = "/snowflake.svg";

    return () => {
      image.onload = null;
    };
  }, [motionAllowed, snowflakeImage]);

  if (!motionAllowed || !snowflakeImage) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-10">
      <Suspense fallback={null}>
        <Snowfall
          images={[snowflakeImage]}
          opacity={[0.55, 0.9]}
          radius={[5, 15]}
          snowflakeCount={200}
          speed={[0.6, 1.4]}
          style={{ opacity: 0.75 }}
          wind={[0, 2]}
        />
      </Suspense>
    </div>
  );
}
