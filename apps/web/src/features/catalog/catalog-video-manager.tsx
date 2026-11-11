"use client";

import {
  CatalogManagedVideoSchema,
  CatalogProductVideoListSchema,
  CatalogVideoProvisionResultSchema,
  MAX_CATALOG_PRODUCT_VIDEOS,
  MAX_CATALOG_VIDEO_DURATION_SECONDS,
  MAX_CATALOG_VIDEO_UPLOAD_BYTES,
  type CatalogManagedProductDetail,
  type CatalogManagedVideo,
} from "@aaraj/contracts";
import { Upload as TusUpload } from "tus-js-client";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  completeCatalogProductVideoUpload,
  deleteCatalogProductVideo,
  fetchManagedProductVideos,
  provisionCatalogProductVideoUpload,
  reorderCatalogProductVideos,
  syncCatalogProductVideo,
  updateCatalogProductVideo,
  uploadCatalogProductVideoCaption,
} from "@/features/catalog/catalog-client";
import {
  getApiErrorMessage,
  readApiErrorResponse,
} from "@/lib/api-error-response";
import { Captions, Film, RefreshCw, Trash2, Upload } from "lucide-react";

type VariantOption = Pick<
  CatalogManagedProductDetail["variants"][number],
  "color" | "isActive"
>;

type VideoEdit = { title: string; description: string; variantColor: string };

function formatBytes(size: number): string {
  return `${(size / 1024 / 1024).toFixed(size >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function videoStatusLabel(status: CatalogManagedVideo["status"]): string {
  switch (status) {
    case "provisioning":
      return "Preparing upload";
    case "awaiting_upload":
      return "Upload not finished";
    case "processing":
      return "Processing";
    case "ready":
      return "Ready";
    case "error":
      return "Needs attention";
    case "deleting":
      return "Provider deletion pending";
    case "deleted":
      return "Deleted";
  }
}

export function CatalogVideoManager({
  productId,
  variants,
}: {
  productId: string;
  variants: VariantOption[];
}) {
  const [videos, setVideos] = useState<CatalogManagedVideo[]>([]);
  const [edits, setEdits] = useState<Record<string, VideoEdit>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [variantColor, setVariantColor] = useState("");
  const [uploadCommandId, setUploadCommandId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadProblem, setUploadProblem] = useState<string | null>(null);
  const [captionFiles, setCaptionFiles] = useState<Record<string, File | null>>(
    {},
  );
  const [captionLanguages, setCaptionLanguages] = useState<
    Record<string, string>
  >({});
  const colors = Array.from(
    new Map(
      variants
        .filter(({ isActive }) => isActive)
        .map(({ color }) => [color.trim().toLocaleLowerCase("en-US"), color]),
    ).values(),
  );
  const remaining = MAX_CATALOG_PRODUCT_VIDEOS - videos.length;

  const applyVideoList = useCallback((loadedVideos: CatalogManagedVideo[]) => {
    setVideos(loadedVideos);
    setEdits(
      Object.fromEntries(
        loadedVideos.map((video) => [
          video.id,
          {
            title: video.title,
            description: video.description ?? "",
            variantColor: video.variantColor ?? "",
          },
        ]),
      ),
    );
    setProblem(null);
  }, []);

  const fetchVideoList = useCallback(async () => {
    const response = await fetchManagedProductVideos(productId);
    if (!response.ok) {
      const error = await readApiErrorResponse(response);
      throw new Error(
        getApiErrorMessage(error) ?? "Could not load product videos.",
      );
    }
    const parsed = CatalogProductVideoListSchema.safeParse(
      await response.json(),
    );
    if (!parsed.success) throw new Error("Invalid video list response.");
    return parsed.data.videos;
  }, [productId]);

  const loadVideos = useCallback(async () => {
    setIsLoading(true);
    try {
      applyVideoList(await fetchVideoList());
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "Could not reach the catalog API. Refresh the video list.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [applyVideoList, fetchVideoList]);

  useEffect(() => {
    let active = true;
    async function loadInitialVideos() {
      try {
        const loadedVideos = await fetchVideoList();
        if (active) applyVideoList(loadedVideos);
      } catch (error) {
        if (active) {
          setProblem(
            error instanceof Error
              ? error.message
              : "Could not reach the catalog API. Refresh the video list.",
          );
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void loadInitialVideos();
    return () => {
      active = false;
    };
  }, [applyVideoList, fetchVideoList]);

  async function startUpload(commandId = crypto.randomUUID()) {
    if (!file) {
      setProblem("Choose a video file before uploading.");
      return;
    }
    const extension = file.name.split(".").at(-1)?.toLocaleLowerCase("en-US");
    if (
      !["mp4", "mov", "webm"].includes(extension ?? "") ||
      file.size <= 0 ||
      file.size > MAX_CATALOG_VIDEO_UPLOAD_BYTES
    ) {
      setProblem("Choose an MP4, MOV, or WebM video up to 512 MB.");
      return;
    }
    if (title.trim().length === 0) {
      setProblem("Enter a descriptive title for this video.");
      return;
    }
    setIsWorking(true);
    setProblem(null);
    setUploadProblem(null);
    setUploadCommandId(commandId);
    setUploadProgress(0);
    try {
      const response = await provisionCatalogProductVideoUpload(productId, {
        commandId,
        fileSizeBytes: file.size,
        title: title.trim(),
        description: description.trim() || null,
        variantColor: variantColor || null,
        reason: "Add product catalogue video",
      });
      if (!response.ok) {
        const error = await readApiErrorResponse(response);
        throw new Error(
          getApiErrorMessage(error) ?? "Could not prepare the video upload.",
        );
      }
      const parsed = CatalogVideoProvisionResultSchema.safeParse(
        await response.json(),
      );
      if (!parsed.success)
        throw new Error("The API returned an invalid upload.");
      await loadVideos();

      const upload = new TusUpload(file, {
        uploadUrl: parsed.data.uploadUrl,
        uploadSize: file.size,
        chunkSize: 50 * 1024 * 1024,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        onProgress(bytesUploaded, bytesTotal) {
          setUploadProgress(
            bytesTotal > 0 ? Math.floor((bytesUploaded / bytesTotal) * 100) : 0,
          );
        },
        onError(error) {
          setUploadProblem(
            `Upload paused: ${error.message}. Retry this file to resume from its last completed chunk.`,
          );
          setIsWorking(false);
        },
        onSuccess() {
          void completeCatalogProductVideoUpload(
            productId,
            parsed.data.video.id,
          )
            .then(async (completion) => {
              if (!completion.ok) {
                setUploadProblem(
                  "The file uploaded. Refresh its provider status to finish processing.",
                );
                await loadVideos();
                return;
              }
              setFile(null);
              setUploadCommandId(null);
              setTitle("");
              setDescription("");
              setVariantColor("");
              setUploadProgress(100);
              toast.add({
                title: "Video uploaded for processing",
                type: "success",
              });
              await loadVideos();
            })
            .catch(async () => {
              setUploadProblem(
                "The file uploaded. Refresh its provider status to finish processing.",
              );
              await loadVideos();
            })
            .finally(() => setIsWorking(false));
        },
      });
      upload.start();
    } catch (error) {
      setUploadProblem(
        error instanceof Error ? error.message : "Could not upload this video.",
      );
      setIsWorking(false);
    }
  }

  async function saveVideo(video: CatalogManagedVideo) {
    const edit = edits[video.id];
    if (!edit) return;
    setIsWorking(true);
    setProblem(null);
    try {
      const response = await updateCatalogProductVideo(productId, video.id, {
        title: edit.title,
        description: edit.description || null,
        variantColor: edit.variantColor || null,
      });
      if (!response.ok) {
        const error = await readApiErrorResponse(response);
        throw new Error(
          getApiErrorMessage(error) ?? "Could not save video details.",
        );
      }
      const parsed = CatalogManagedVideoSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Invalid video details response.");
      setVideos((current) =>
        current.map((item) => (item.id === video.id ? parsed.data : item)),
      );
      toast.add({ title: "Video details saved", type: "success" });
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "Could not save video details.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function syncVideo(video: CatalogManagedVideo) {
    setIsWorking(true);
    setProblem(null);
    try {
      const response = await syncCatalogProductVideo(productId, video.id);
      if (!response.ok) {
        const error = await readApiErrorResponse(response);
        throw new Error(
          getApiErrorMessage(error) ?? "Could not refresh provider status.",
        );
      }
      const parsed = CatalogManagedVideoSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Invalid video status response.");
      setVideos((current) =>
        current.map((item) => (item.id === video.id ? parsed.data : item)),
      );
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "Could not refresh provider status.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function uploadCaption(video: CatalogManagedVideo) {
    const captionFile = captionFiles[video.id];
    const language = (captionLanguages[video.id] ?? "bn").trim();
    if (!captionFile) {
      setProblem("Choose a WebVTT caption file first.");
      return;
    }
    setIsWorking(true);
    setProblem(null);
    try {
      const response = await uploadCatalogProductVideoCaption(
        productId,
        video.id,
        language,
        captionFile,
      );
      if (!response.ok) {
        const error = await readApiErrorResponse(response);
        throw new Error(
          getApiErrorMessage(error) ?? "Could not add this caption.",
        );
      }
      await loadVideos();
      setCaptionFiles((current) => ({ ...current, [video.id]: null }));
      toast.add({ title: "Caption added", type: "success" });
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Could not add this caption.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function removeVideo(video: CatalogManagedVideo) {
    if (
      !window.confirm(
        `Permanently remove “${video.title}” from the video library?`,
      )
    )
      return;
    setIsWorking(true);
    setProblem(null);
    try {
      const response = await deleteCatalogProductVideo(productId, video.id, {
        reason: "Remove video from product catalogue",
      });
      if (!response.ok) {
        const error = await readApiErrorResponse(response);
        throw new Error(
          getApiErrorMessage(error) ?? "Provider deletion is pending.",
        );
      }
      await loadVideos();
      toast.add({ title: "Video removed", type: "success" });
    } catch (error) {
      await loadVideos();
      setProblem(
        error instanceof Error
          ? error.message
          : "Provider deletion is pending.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function moveVideo(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= videos.length) return;
    const moved = [...videos];
    const [video] = moved.splice(index, 1);
    if (!video) return;
    moved.splice(targetIndex, 0, video);
    setVideos(moved);
    setIsWorking(true);
    try {
      const response = await reorderCatalogProductVideos(productId, {
        videoIds: moved.map(({ id }) => id),
      });
      if (!response.ok) {
        const error = await readApiErrorResponse(response);
        throw new Error(
          getApiErrorMessage(error) ?? "Could not save video order.",
        );
      }
      const parsed = CatalogProductVideoListSchema.safeParse(
        await response.json(),
      );
      if (!parsed.success) throw new Error("Invalid video order response.");
      setVideos(parsed.data.videos);
    } catch (error) {
      await loadVideos();
      setProblem(
        error instanceof Error ? error.message : "Could not save video order.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Film aria-hidden="true" className="size-5" /> Product videos
        </CardTitle>
        <CardDescription>
          Resumable, private-by-default videos. Add captions so customers can
          follow the clip without sound.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {problem && (
          <p
            className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            {problem}
          </p>
        )}
        <div className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="catalog-video-file">Video file</FieldLabel>
            <Input
              accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
              id="catalog-video-file"
              onChange={(event) => {
                const selected = event.currentTarget.files?.[0] ?? null;
                setFile(selected);
                if (selected && !title)
                  setTitle(selected.name.replace(/\.[^.]+$/, ""));
                setUploadProblem(null);
              }}
              type="file"
            />
            <FieldDescription>
              MP4, MOV, or WebM; up to{" "}
              {formatBytes(MAX_CATALOG_VIDEO_UPLOAD_BYTES)} and{" "}
              {MAX_CATALOG_VIDEO_DURATION_SECONDS} seconds.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="catalog-video-title">
              Accessible video title
            </FieldLabel>
            <Input
              id="catalog-video-title"
              maxLength={160}
              onChange={(event) => setTitle(event.currentTarget.value)}
              value={title}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="catalog-video-description">
              Description
            </FieldLabel>
            <Input
              id="catalog-video-description"
              maxLength={1000}
              onChange={(event) => setDescription(event.currentTarget.value)}
              value={description}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="catalog-video-color">
              Applies to color
            </FieldLabel>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              id="catalog-video-color"
              onChange={(event) => setVariantColor(event.currentTarget.value)}
              value={variantColor}
            >
              <option value="">All colors</option>
              {colors.map((color) => (
                <option key={color} value={color}>
                  {color}
                </option>
              ))}
            </select>
          </Field>
          {file && (
            <p className="text-sm text-muted-foreground md:col-span-2">
              {file.name} · {formatBytes(file.size)} · {uploadProgress}%
              uploaded
            </p>
          )}
          {uploadProblem && (
            <p className="text-sm text-destructive md:col-span-2" role="alert">
              {uploadProblem}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <Button
              disabled={isWorking || !file || remaining <= 0}
              onClick={() => void startUpload(uploadCommandId ?? undefined)}
              type="button"
            >
              <Upload aria-hidden="true" className="mr-2 size-4" />
              {uploadCommandId ? "Resume upload" : "Upload video"}
            </Button>
            <Button
              disabled={isWorking || isLoading}
              onClick={() => void loadVideos()}
              type="button"
              variant="outline"
            >
              <RefreshCw aria-hidden="true" className="mr-2 size-4" /> Refresh
              list
            </Button>
            <span className="text-sm text-muted-foreground">
              {remaining} of {MAX_CATALOG_PRODUCT_VIDEOS} slots available
            </span>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            Loading video library…
          </p>
        ) : videos.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No product videos yet.
          </p>
        ) : (
          <ol className="space-y-4">
            {videos.map((video, index) => {
              const edit = edits[video.id] ?? {
                title: video.title,
                description: video.description ?? "",
                variantColor: video.variantColor ?? "",
              };
              return (
                <li
                  className="rounded-xl border border-border p-4"
                  key={video.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{video.title}</h3>
                      <Badge
                        variant={
                          video.status === "ready" ? "default" : "secondary"
                        }
                      >
                        {videoStatusLabel(video.status)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        aria-label={`Move ${video.title} up`}
                        disabled={isWorking || index === 0}
                        onClick={() => void moveVideo(index, -1)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        ↑
                      </Button>
                      <Button
                        aria-label={`Move ${video.title} down`}
                        disabled={isWorking || index === videos.length - 1}
                        onClick={() => void moveVideo(index, 1)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        ↓
                      </Button>
                      {video.status !== "ready" &&
                        video.status !== "deleted" && (
                          <Button
                            disabled={isWorking}
                            onClick={() => void syncVideo(video)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <RefreshCw
                              aria-hidden="true"
                              className="mr-2 size-4"
                            />{" "}
                            Sync
                          </Button>
                        )}
                      <Button
                        aria-label={`Remove ${video.title}`}
                        disabled={isWorking}
                        onClick={() => void removeVideo(video)}
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor={`video-title-${video.id}`}>
                        Title
                      </FieldLabel>
                      <Input
                        id={`video-title-${video.id}`}
                        maxLength={160}
                        onChange={(event) =>
                          setEdits((current) => ({
                            ...current,
                            [video.id]: {
                              ...edit,
                              title: event.currentTarget.value,
                            },
                          }))
                        }
                        value={edit.title}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`video-description-${video.id}`}>
                        Description
                      </FieldLabel>
                      <Input
                        id={`video-description-${video.id}`}
                        maxLength={1000}
                        onChange={(event) =>
                          setEdits((current) => ({
                            ...current,
                            [video.id]: {
                              ...edit,
                              description: event.currentTarget.value,
                            },
                          }))
                        }
                        value={edit.description}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`video-color-${video.id}`}>
                        Color
                      </FieldLabel>
                      <select
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        id={`video-color-${video.id}`}
                        onChange={(event) =>
                          setEdits((current) => ({
                            ...current,
                            [video.id]: {
                              ...edit,
                              variantColor: event.currentTarget.value,
                            },
                          }))
                        }
                        value={edit.variantColor}
                      >
                        <option value="">All colors</option>
                        {colors.map((color) => (
                          <option key={color} value={color}>
                            {color}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      disabled={isWorking}
                      onClick={() => void saveVideo(video)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Save details
                    </Button>
                    {video.durationSeconds && (
                      <span className="text-sm text-muted-foreground">
                        Duration: {video.durationSeconds.toFixed(1)} seconds
                      </span>
                    )}
                  </div>
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <Captions aria-hidden="true" className="size-4" />{" "}
                      Captions
                    </p>
                    {video.captions.length > 0 && (
                      <ul className="mb-3 flex flex-wrap gap-2">
                        {video.captions.map((caption) => (
                          <li key={caption.language}>
                            <Badge variant="outline">
                              {caption.label} · {caption.status}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                    {video.status === "ready" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          aria-label={`Caption language for ${video.title}`}
                          className="max-w-28"
                          maxLength={35}
                          onChange={(event) =>
                            setCaptionLanguages((current) => ({
                              ...current,
                              [video.id]: event.currentTarget.value,
                            }))
                          }
                          placeholder="bn"
                          value={captionLanguages[video.id] ?? "bn"}
                        />
                        <Input
                          aria-label={`WebVTT caption file for ${video.title}`}
                          accept=".vtt,text/vtt"
                          className="max-w-sm"
                          onChange={(event) => {
                            const selectedFile =
                              event.currentTarget.files?.[0] ?? null;
                            setCaptionFiles((current) => ({
                              ...current,
                              [video.id]: selectedFile,
                            }));
                          }}
                          type="file"
                        />
                        <Button
                          disabled={isWorking || !captionFiles[video.id]}
                          onClick={() => void uploadCaption(video)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          Upload WebVTT
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Captions can be added after processing finishes.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
