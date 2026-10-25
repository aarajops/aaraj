"use client";

import {
  CatalogMediaSchema,
  CatalogProductMediaListSchema,
  MAX_CATALOG_MEDIA_UPLOAD_CONCURRENCY,
  MAX_CATALOG_MEDIA_UPLOAD_BYTES,
  MAX_CATALOG_PRODUCT_MEDIA,
  type CatalogManagedProductDetail,
  type CatalogMedia,
} from "@aaraj/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteCatalogProductMedia,
  fetchManagedProductMedia,
  uploadCatalogProductMedia,
} from "@/features/catalog/catalog-client";
import {
  getApiErrorMessage,
  readApiErrorResponse,
} from "@/lib/api-error-response";
import { RefreshCw, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type VariantOption = Pick<
  CatalogManagedProductDetail["variants"][number],
  "id" | "color" | "sizeLabel" | "isActive"
>;

interface UploadDraft {
  commandId: string;
  variantId?: string;
  altText: string;
}

interface SelectedUpload {
  id: string;
  file: File;
  altText: string;
  draft?: UploadDraft;
  error?: string;
  retryable?: boolean;
}

type Operation = `upload:${string}` | `delete:${string}` | "refresh" | null;

const fileFieldClassName =
  "h-auto w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium";
const allVariantsValue = "all";

interface MediaListResult {
  media: CatalogMedia[] | null;
  message: string | null;
}

async function requestManagedProductMedia(
  productId: string,
): Promise<MediaListResult> {
  try {
    const response = await fetchManagedProductMedia(productId);
    if (!response.ok) {
      const apiError = await readApiErrorResponse(response);
      return {
        media: null,
        message:
          getApiErrorMessage(apiError) ??
          "The API returned an unreadable error response.",
      };
    }

    const parsed = CatalogProductMediaListSchema.safeParse(
      await response.json(),
    );
    if (!parsed.success) {
      return {
        media: null,
        message: "The API returned an invalid media response.",
      };
    }

    return { media: parsed.data.media, message: null };
  } catch {
    return {
      media: null,
      message: "Could not reach the catalog API. Try refreshing the list.",
    };
  }
}

export function CatalogMediaManager({
  productId,
  variants,
}: {
  productId: string;
  variants: VariantOption[];
}) {
  const [media, setMedia] = useState<CatalogMedia[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedProductId, setLoadedProductId] = useState<string | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [operation, setOperation] = useState<Operation>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [selectedUploads, setSelectedUploads] = useState<SelectedUpload[]>([]);
  const [variantId, setVariantId] = useState("");
  const mediaIsLoading = isLoading || loadedProductId !== productId;
  const mediaLimitReached = media.length >= MAX_CATALOG_PRODUCT_MEDIA;
  const remainingMediaSlots = Math.max(
    0,
    MAX_CATALOG_PRODUCT_MEDIA - media.length - selectedUploads.length,
  );
  const hasPendingUploadCommands = selectedUploads.some(
    (upload) => upload.draft !== undefined,
  );
  const activeVariants = variants.filter((variant) => variant.isActive);

  const loadMedia = useCallback(async () => {
    setIsLoading(true);
    setIsUnavailable(false);
    const result = await requestManagedProductMedia(productId);
    setIsLoading(false);
    setLoadedProductId(productId);
    if (result.media === null) {
      setProblem(result.message);
      setIsUnavailable(true);
      return;
    }

    setMedia(result.media);
    setProblem(null);
  }, [productId]);

  useEffect(() => {
    let isCurrent = true;
    void requestManagedProductMedia(productId).then((result) => {
      if (!isCurrent) return;
      setIsLoading(false);
      setLoadedProductId(productId);
      if (result.media === null) {
        setProblem(result.message);
        setIsUnavailable(true);
        return;
      }

      setMedia(result.media);
      setProblem(null);
      setIsUnavailable(false);
    });

    return () => {
      isCurrent = false;
    };
  }, [productId]);

  async function uploadSelectedFiles() {
    if (selectedUploads.length === 0) {
      setProblem("Choose one or more image files before uploading.");
      return;
    }
    if (
      selectedUploads.some(
        (upload) => !upload.draft && upload.altText.trim().length === 0,
      )
    ) {
      setProblem("Enter alt text for each selected image.");
      return;
    }

    const uploads = selectedUploads
      .filter((upload) => !upload.draft || upload.retryable)
      .map((upload) => ({
        ...upload,
        draft: upload.draft ?? {
          commandId: upload.id,
          ...(variantId ? { variantId } : {}),
          altText: upload.altText.trim(),
        },
      }));
    if (uploads.length === 0) return;
    setSelectedUploads((current) =>
      current.map(
        (upload) =>
          uploads.find((pending) => pending.id === upload.id) ?? upload,
      ),
    );
    setOperation("upload:batch");
    setProblem(null);

    const failures = new Map<string, SelectedUpload>();
    let nextIndex = 0;
    let completed = 0;

    async function uploadWorker() {
      while (nextIndex < uploads.length) {
        const upload = uploads[nextIndex++];
        if (!upload) continue;
        try {
          const response = await uploadCatalogProductMedia(
            productId,
            upload.draft,
            upload.file,
          );
          if (!response.ok) {
            const apiError = await readApiErrorResponse(response);
            failures.set(upload.id, {
              ...upload,
              error:
                getApiErrorMessage(apiError) ??
                "The API returned an unreadable error response.",
              retryable: response.status === 429 || response.status >= 500,
            });
            continue;
          }

          const parsed = CatalogMediaSchema.safeParse(await response.json());
          if (!parsed.success) {
            failures.set(upload.id, {
              ...upload,
              error: "The API returned an invalid media response.",
              retryable: true,
            });
            continue;
          }
          completed += 1;
        } catch {
          failures.set(upload.id, {
            ...upload,
            error: "Could not reach the API. Retry this same upload command.",
            retryable: true,
          });
        }
      }
    }

    try {
      await Promise.all(
        Array.from(
          {
            length: Math.min(
              MAX_CATALOG_MEDIA_UPLOAD_CONCURRENCY,
              uploads.length,
            ),
          },
          () => uploadWorker(),
        ),
      );
      await loadMedia();
      const remaining = selectedUploads
        .filter((upload) => upload.draft && !upload.retryable)
        .concat(
          uploads
            .filter((upload) => failures.has(upload.id))
            .map((upload) => failures.get(upload.id)!),
        );
      setSelectedUploads(remaining);

      if (completed > 0) {
        toast.add({
          title: `${completed} image${completed === 1 ? "" : "s"} uploaded`,
          type: "success",
        });
      }
      if (remaining.length > 0) {
        setProblem(
          `${remaining.length} upload${remaining.length === 1 ? " needs" : "s need"} attention. Retry temporary failures with the same command, or remove files with permanent errors.`,
        );
      } else {
        setVariantId("");
      }
    } finally {
      setOperation(null);
    }
  }

  async function retryPendingUpload(item: CatalogMedia, file: File) {
    const draft = {
      commandId: item.commandId,
      ...(item.variantId ? { variantId: item.variantId } : {}),
      altText: item.altText,
      ...(item.reason ? { reason: item.reason } : {}),
    };
    setOperation(`upload:${item.id}`);
    setProblem(null);
    try {
      const response = await uploadCatalogProductMedia(productId, draft, file);
      if (!response.ok) {
        const apiError = await readApiErrorResponse(response);
        await loadMedia();
        setProblem(
          getApiErrorMessage(apiError) ??
            "The API returned an unreadable error response.",
        );
        return;
      }
      const parsed = CatalogMediaSchema.safeParse(await response.json());
      if (!parsed.success) {
        await loadMedia();
        setProblem("The API returned an invalid media response.");
        return;
      }
      await loadMedia();
      toast.add({ title: "Image upload recovered", type: "success" });
    } catch {
      await loadMedia();
      setProblem("Could not reach the API. Retry with the same original file.");
    } finally {
      setOperation(null);
    }
  }

  async function deleteMedia(item: CatalogMedia) {
    setOperation(`delete:${item.id}`);
    setProblem(null);
    try {
      const response = await deleteCatalogProductMedia(productId, item.id, {});
      if (!response.ok) {
        const apiError = await readApiErrorResponse(response);
        const message =
          getApiErrorMessage(apiError) ??
          "The API returned an unreadable error response.";
        await loadMedia();
        setProblem(message);
        return;
      }

      toast.add({ title: "Image deleted", type: "success" });
      await loadMedia();
    } catch {
      await loadMedia();
      setProblem(
        "Could not reach the catalog API. Refresh and retry deletion.",
      );
    } finally {
      setOperation(null);
    }
  }

  return (
    <Card
      aria-labelledby="product-media-heading"
      className="gap-0 p-0"
      role="region"
    >
      <CardHeader className="px-6 pt-6 sm:px-7 sm:pt-7">
        <CardTitle
          aria-level={2}
          id="product-media-heading"
          role="heading"
          className="text-xl font-semibold"
        >
          Product media
        </CardTitle>
        <CardDescription>
          Original files stay private. Storefront images appear after
          publishing.
        </CardDescription>
        <CardAction className="flex flex-wrap items-center gap-2">
          <Badge
            aria-label={`${media.length} of ${MAX_CATALOG_PRODUCT_MEDIA} images used`}
            variant="secondary"
          >
            {media.length} / {MAX_CATALOG_PRODUCT_MEDIA}
          </Badge>
          <Button
            disabled={operation !== null || mediaIsLoading}
            onClick={() => {
              setProblem(null);
              setOperation("refresh");
              void loadMedia().finally(() => setOperation(null));
            }}
            type="button"
            variant="outline"
            size="sm"
            aria-label="Refresh product media"
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="grid gap-5 px-6 pb-6 sm:px-7 sm:pb-7">
        {problem && (
          <p
            className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            {problem}
          </p>
        )}
        <form
          className="grid gap-4 border-t border-border pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            void uploadSelectedFiles();
          }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="font-medium">Add images</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                JPEG, PNG, or WebP · up to{" "}
                {formatBytes(MAX_CATALOG_MEDIA_UPLOAD_BYTES)} each
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {remainingMediaSlots} image{" "}
              {remainingMediaSlots === 1 ? "slot" : "slots"} available
            </p>
          </div>

          <Field>
            <FieldLabel htmlFor="catalog-media-file">Image files</FieldLabel>
            <Input
              accept="image/jpeg,image/png,image/webp"
              aria-describedby="catalog-media-file-help"
              className={fileFieldClassName}
              disabled={
                operation !== null ||
                hasPendingUploadCommands ||
                mediaLimitReached ||
                remainingMediaSlots === 0
              }
              id="catalog-media-file"
              multiple
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                const acceptedFiles = files.slice(0, remainingMediaSlots);
                setSelectedUploads((current) => [
                  ...current,
                  ...acceptedFiles.map((file) => ({
                    id: crypto.randomUUID(),
                    file,
                    altText: "",
                  })),
                ]);
                if (acceptedFiles.length < files.length) {
                  setProblem(
                    `Only ${remainingMediaSlots} more image${remainingMediaSlots === 1 ? " can" : "s can"} be selected for this product.`,
                  );
                } else {
                  setProblem(null);
                }
                event.currentTarget.value = "";
              }}
              type="file"
            />
            <FieldDescription id="catalog-media-file-help">
              Enter alt text for each selected image.
            </FieldDescription>
          </Field>

          {selectedUploads.length > 0 && (
            <ul
              className="divide-y divide-border rounded-lg border border-border"
              aria-label="Selected images"
            >
              {selectedUploads.map((upload) => (
                <li className="grid gap-3 p-3 sm:grid-cols-2" key={upload.id}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {upload.file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(upload.file.size)}
                    </p>
                    <Input
                      aria-label={`Alt text for ${upload.file.name}`}
                      className="mt-2 h-9"
                      disabled={
                        operation !== null || upload.draft !== undefined
                      }
                      maxLength={500}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setSelectedUploads((current) =>
                          current.map((candidate) =>
                            candidate.id === upload.id
                              ? { ...candidate, altText: value }
                              : candidate,
                          ),
                        );
                      }}
                      placeholder="Describe this image"
                      required={!upload.draft}
                      value={upload.draft?.altText ?? upload.altText}
                    />
                    {upload.error && (
                      <p className="mt-2 text-sm text-destructive" role="alert">
                        {upload.error}
                      </p>
                    )}
                  </div>
                  <Button
                    aria-label={`Remove ${upload.file.name}`}
                    className="sm:col-start-2 sm:justify-self-end"
                    disabled={operation !== null}
                    onClick={() =>
                      setSelectedUploads((current) =>
                        current.filter(
                          (candidate) => candidate.id !== upload.id,
                        ),
                      )
                    }
                    type="button"
                    variant="outline"
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
            <Field>
              <FieldLabel htmlFor="catalog-media-variant">
                Variant association
              </FieldLabel>
              <Select
                disabled={operation !== null || hasPendingUploadCommands}
                onValueChange={(value) =>
                  setVariantId(value === allVariantsValue ? "" : (value ?? ""))
                }
                value={variantId || allVariantsValue}
              >
                <SelectTrigger id="catalog-media-variant">
                  <SelectValue placeholder="All product variants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={allVariantsValue}>
                    All product variants
                  </SelectItem>
                  {activeVariants.map((variant) => (
                    <SelectItem key={variant.id} value={variant.id}>
                      {variant.color} · {variant.sizeLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Button
              className="sm:justify-self-end"
              disabled={
                operation !== null ||
                selectedUploads.length === 0 ||
                mediaLimitReached ||
                selectedUploads.every(
                  (upload) => upload.draft !== undefined && !upload.retryable,
                )
              }
              type="submit"
            >
              <Upload aria-hidden="true" />
              {operation?.startsWith("upload:")
                ? "Uploading images…"
                : selectedUploads.some((upload) => upload.draft !== undefined)
                  ? "Retry remaining uploads"
                  : "Upload images"}
            </Button>
          </div>
        </form>

        <section
          aria-labelledby="uploaded-media-heading"
          className="grid gap-3 border-t border-border pt-5"
        >
          <h3 className="font-medium" id="uploaded-media-heading">
            Uploaded images
          </h3>
          {mediaIsLoading ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading product media…
            </p>
          ) : isUnavailable ? null : media.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              No media has been uploaded for this product.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {media.map((item) => (
                <li
                  className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4"
                  key={item.id}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-medium">
                        Image {item.sortOrder + 1}
                      </h4>
                      <Badge
                        className={mediaStatusClassName(item.status)}
                        variant="outline"
                      >
                        {mediaStatusLabel(item.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 break-words text-sm">{item.altText}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.contentType} · {formatBytes(item.sizeBytes)}
                      {item.variantId
                        ? ` · ${variantLabel(variants, item.variantId)}`
                        : " · All variants"}
                    </p>
                    {item.status === "rejected" && (
                      <p className="mt-2 text-sm text-warning">
                        Unsupported or invalid image. Delete it and upload a
                        valid JPEG, PNG, or WebP file.
                      </p>
                    )}
                    {(item.status === "uploading" ||
                      item.status === "quarantined" ||
                      item.status === "processing") && (
                      <div className="mt-3 grid gap-2">
                        <p className="text-sm text-muted-foreground">
                          Select the original file to retry.
                        </p>
                        <Input
                          accept="image/jpeg,image/png,image/webp"
                          aria-label={`Choose original file to retry ${item.altText}`}
                          className={fileFieldClassName}
                          disabled={operation !== null}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = "";
                            if (file) void retryPendingUpload(item, file);
                          }}
                          type="file"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 sm:items-end">
                    {(item.status === "quarantined" ||
                      item.status === "ready" ||
                      item.status === "rejected") && (
                      <Button
                        disabled={operation !== null}
                        onClick={() => void deleteMedia(item)}
                        type="button"
                        variant="destructive"
                      >
                        {operation === `delete:${item.id}`
                          ? "Deleting…"
                          : "Delete media"}
                      </Button>
                    )}
                    {item.status === "deleting" && (
                      <Button
                        disabled={operation !== null}
                        onClick={() => void deleteMedia(item)}
                        type="button"
                        variant="outline"
                      >
                        {operation === `delete:${item.id}`
                          ? "Deleting…"
                          : "Retry deletion"}
                      </Button>
                    )}
                    {(item.status === "uploading" ||
                      item.status === "processing") && (
                      <p className="text-sm text-muted-foreground">
                        Retry processing before deletion.
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function mediaStatusClassName(status: CatalogMedia["status"]): string {
  switch (status) {
    case "ready":
      return "border-success/30 bg-success/10 text-success";
    case "rejected":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "uploading":
    case "processing":
    case "deleting":
      return "border-warning/30 bg-warning/10 text-warning";
    case "quarantined":
    case "deleted":
      return "";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MiB`;
}

function mediaStatusLabel(status: CatalogMedia["status"]): string {
  switch (status) {
    case "uploading":
      return "Upload incomplete";
    case "quarantined":
      return "Private source";
    case "processing":
      return "Processing incomplete";
    case "ready":
      return "Processed";
    case "rejected":
      return "Rejected";
    case "deleting":
      return "Deletion incomplete";
    case "deleted":
      return "Deleted";
  }
}

function variantLabel(variants: VariantOption[], variantId: string): string {
  const variant = variants.find((item) => item.id === variantId);
  return variant
    ? `${variant.color} · ${variant.sizeLabel}`
    : "Archived variant";
}
