"use client";

import {
  API_V1_BASE_PATH,
  CatalogPublishedVideoFeedSchema,
} from "@aaraj/contracts";
import type { CatalogProductDetail } from "@aaraj/contracts";
import { Play, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

export function CatalogVideoGallery({
  slug,
  productName,
  variants,
  initialColor,
}: {
  slug: string;
  productName: string;
  variants: CatalogProductDetail["variants"];
  initialColor?: string;
}) {
  const [feed, setFeed] = useState<{
    slug: string;
    videos: ReturnType<typeof CatalogPublishedVideoFeedSchema.parse>["videos"];
    problem: string | null;
  } | null>(null);
  const [activeColor, setActiveColor] = useState(initialColor ?? "");
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadVideos() {
      try {
        const response = await fetch(
          `${API_V1_BASE_PATH}/catalog/products/${encodeURIComponent(slug)}/videos`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok)
          throw new Error("Product videos are temporarily unavailable.");
        const parsed = CatalogPublishedVideoFeedSchema.safeParse(
          await response.json(),
        );
        if (!parsed.success)
          throw new Error("Product videos are temporarily unavailable.");
        setFeed({ slug, videos: parsed.data.videos, problem: null });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setFeed({
          slug,
          videos: [],
          problem:
            error instanceof Error
              ? error.message
              : "Product videos are temporarily unavailable.",
        });
      }
    }
    void loadVideos();
    return () => controller.abort();
  }, [slug]);

  const videos = feed?.slug === slug ? feed.videos : [];
  const problem = feed?.slug === slug ? feed.problem : null;
  const isLoading = feed?.slug !== slug;

  const colors = Array.from(
    new Map(
      variants.map(({ color }) => [
        color.trim().toLocaleLowerCase("en-US"),
        color,
      ]),
    ).values(),
  );
  const visibleVideos = videos.filter(
    ({ variantColor }) =>
      !variantColor ||
      !activeColor ||
      variantColor.toLocaleLowerCase("en-US") ===
        activeColor.toLocaleLowerCase("en-US"),
  );

  if (isLoading && videos.length === 0) return null;
  if (!problem && visibleVideos.length === 0) return null;

  return (
    <section
      aria-labelledby="product-videos-heading"
      className="max-w-5xl border-t border-border pt-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2
            className="text-lg font-semibold tracking-tight"
            id="product-videos-heading"
          >
            Product videos
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            See the fabric, fit, and details in motion.
          </p>
        </div>
        {colors.length > 1 && (
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Color</span>
            <select
              className="h-10 min-w-36 rounded-md border border-input bg-background px-3"
              onChange={(event) => setActiveColor(event.currentTarget.value)}
              value={activeColor}
            >
              <option value="">All colors</option>
              {colors.map((color) => (
                <option key={color} value={color}>
                  {color}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {problem ? (
        <p
          className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
          role="status"
        >
          {problem}
          <button
            className="inline-flex items-center gap-1 underline"
            onClick={() => window.location.reload()}
            type="button"
          >
            <RefreshCw aria-hidden="true" className="size-3.5" /> Try again
          </button>
        </p>
      ) : (
        <ul className="mt-5 grid gap-5 sm:grid-cols-2">
          {visibleVideos.map((video) => (
            <li
              className="overflow-hidden rounded-xl border border-border"
              key={video.id}
            >
              <div className="aspect-video bg-muted">
                {playingId === video.id ? (
                  <iframe
                    allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen; web-share"
                    allowFullScreen
                    className="size-full border-0"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    src={video.playbackUrl}
                    title={`${productName}: ${video.title}`}
                  />
                ) : (
                  <button
                    aria-label={`Play ${video.title}`}
                    className="flex size-full items-center justify-center bg-foreground/5 text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-primary"
                    onClick={() => setPlayingId(video.id)}
                    type="button"
                  >
                    <span className="flex size-14 items-center justify-center rounded-full bg-background shadow-md">
                      <Play
                        aria-hidden="true"
                        className="ml-1 size-6 fill-current"
                      />
                    </span>
                  </button>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-medium">{video.title}</h3>
                {video.description && (
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {video.description}
                  </p>
                )}
                {video.captions.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Captions available:{" "}
                    {video.captions
                      .filter(({ status }) => status === "ready")
                      .map(({ label }) => label)
                      .join(", ")}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
