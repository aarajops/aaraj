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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  deleteCatalogProductMedia,
  fetchManagedProductMedia,
  uploadCatalogProductMedia,
} from "@/features/catalog/catalog-client";
import {
  getApiErrorMessage,
  readApiErrorResponse,
} from "@/lib/api-error-response";
import { useCallback, useEffect, useState } from "react";

type VariantOption = Pick<
  CatalogManagedProductDetail["variants"][number],
  "id" | "color" | "sizeLabel" | "isActive"
>;

interface UploadDraft {
  commandId: string;
  variantId?: string;
  altText: string;
  reason: string;
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
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedUploads, setSelectedUploads] = useState<SelectedUpload[]>([]);
  const [variantId, setVariantId] = useState("");
  const [reason, setReason] = useState("");
  const [deletionReasons, setDeletionReasons] = useState<
    Record<string, string>
  >({});
  const mediaIsLoading = isLoading || loadedProductId !== productId;
  const mediaLimitReached = media.length >= MAX_CATALOG_PRODUCT_MEDIA;
  const remainingMediaSlots = Math.max(
    0,
    MAX_CATALOG_PRODUCT_MEDIA - media.length - selectedUploads.length,
  );
  const hasPendingUploadCommands = selectedUploads.some(
    (upload) => upload.draft !== undefined,
  );

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
    if (reason.trim().length < 3) {
      setProblem("Enter an audit reason with at least 3 characters.");
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
          reason: reason.trim(),
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
    setNotice(null);

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
        setNotice(
          `${completed} upload${completed === 1 ? " was" : "s were"} saved. Check each image's status below.`,
        );
      }
      if (remaining.length > 0) {
        setProblem(
          `${remaining.length} upload${remaining.length === 1 ? " needs" : "s need"} attention. Retry temporary failures with the same command, or remove files with permanent errors.`,
        );
      } else {
        setVariantId("");
        setReason("");
        if (completed === 0) setNotice("No upload commands needed processing.");
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
      reason: item.reason,
    };
    setOperation(`upload:${item.id}`);
    setProblem(null);
    setNotice(null);
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
      setNotice("Upload recovery completed.");
    } catch {
      await loadMedia();
      setProblem("Could not reach the API. Retry with the same original file.");
    } finally {
      setOperation(null);
    }
  }

  async function deleteMedia(item: CatalogMedia, reason: string) {
    setOperation(`delete:${item.id}`);
    setProblem(null);
    setNotice(null);
    try {
      const response = await deleteCatalogProductMedia(productId, item.id, {
        reason,
      });
      if (!response.ok) {
        const apiError = await readApiErrorResponse(response);
        const message =
          getApiErrorMessage(apiError) ??
          "The API returned an unreadable error response.";
        await loadMedia();
        setProblem(message);
        return;
      }

      setNotice("Media deletion completed.");
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
      className="gap-0 rounded-2xl border border-border bg-card/70 p-6 sm:p-7"
      role="region"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold" id="product-media-heading">
            Product media
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Originals stay private. Processed images appear on public product
            pages only after the product is published.
          </p>
        </div>
        <Button
          disabled={operation !== null || mediaIsLoading}
          onClick={() => {
            setProblem(null);
            setOperation("refresh");
            void loadMedia().finally(() => setOperation(null));
          }}
          type="button"
          variant="outline"
        >
          Refresh media
        </Button>
      </div>

      {problem && (
        <p
          className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {problem}
        </p>
      )}
      {notice && (
        <p
          className="mt-5 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success"
          role="status"
        >
          {notice}
        </p>
      )}

      <form
        className="mt-6 grid gap-4 rounded-xl border border-border p-4 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void uploadSelectedFiles();
        }}
      >
        <div>
          <h3 className="font-medium">Upload images</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            JPEG, PNG, or WebP. Maximum size:{" "}
            {formatBytes(MAX_CATALOG_MEDIA_UPLOAD_BYTES)}.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Up to {MAX_CATALOG_PRODUCT_MEDIA} media records per product,
            including pending and rejected uploads.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Select up to {remainingMediaSlots} more image
            {remainingMediaSlots === 1 ? "" : "s"}. Uploads run concurrently
            with a bounded limit.
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
            The server checks the actual file content. The filename and browser
            MIME type are not trusted. Enter alt text for each image.
          </FieldDescription>
        </Field>

        {selectedUploads.length > 0 && (
          <ul className="grid gap-3" aria-label="Selected images">
            {selectedUploads.map((upload) => (
              <li
                className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                key={upload.id}
              >
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
                    disabled={operation !== null || upload.draft !== undefined}
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
                  className="justify-self-start sm:justify-self-end"
                  disabled={operation !== null}
                  onClick={() =>
                    setSelectedUploads((current) =>
                      current.filter((candidate) => candidate.id !== upload.id),
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

        <Field>
          <FieldLabel htmlFor="catalog-media-variant">
            Variant association (optional)
          </FieldLabel>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            disabled={operation !== null || hasPendingUploadCommands}
            id="catalog-media-variant"
            onChange={(event) => setVariantId(event.currentTarget.value)}
            value={variantId}
          >
            <option value="">All product variants</option>
            {variants
              .filter((variant) => variant.isActive)
              .map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.color} · {variant.sizeLabel}
                </option>
              ))}
          </select>
        </Field>

        <Field>
          <FieldLabel htmlFor="catalog-media-reason">Audit reason</FieldLabel>
          <Input
            className="h-10"
            disabled={operation !== null || hasPendingUploadCommands}
            id="catalog-media-reason"
            maxLength={500}
            minLength={3}
            onChange={(event) => setReason(event.currentTarget.value)}
            required
            value={reason}
          />
        </Field>

        <Button
          className="justify-self-start"
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
          {operation?.startsWith("upload:")
            ? "Uploading images…"
            : selectedUploads.some((upload) => upload.draft !== undefined)
              ? "Retry remaining uploads"
              : "Upload images"}
        </Button>
      </form>

      <section aria-labelledby="uploaded-media-heading" className="mt-7">
        <h3 className="font-medium" id="uploaded-media-heading">
          Uploaded media
        </h3>
        {mediaIsLoading ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            Loading product media…
          </p>
        ) : isUnavailable ? null : media.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
            No media has been uploaded for this product.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
            {media.map((item) => (
              <li
                className="grid gap-4 p-4 sm:grid-cols-[1fr_auto]"
                key={item.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-medium">Image {item.sortOrder + 1}</h4>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs capitalize text-muted-foreground">
                      {mediaStatusLabel(item.status)}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-sm">{item.altText}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.contentType} · {formatBytes(item.sizeBytes)}
                    {item.variantId
                      ? ` · ${variantLabel(variants, item.variantId)}`
                      : " · All variants"}
                  </p>
                  {item.status === "quarantined" && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Private source; choose the original file to resume
                      processing.
                    </p>
                  )}
                  {item.status === "processing" && (
                    <p className="mt-2 text-sm text-warning">
                      Processing is incomplete. Choose the same original file to
                      safely retry.
                    </p>
                  )}
                  {item.status === "rejected" && (
                    <p className="mt-2 text-sm text-warning">
                      This file could not be decoded as a supported image.
                      Delete it and upload a valid JPEG, PNG, or WebP file.
                    </p>
                  )}
                  {item.status === "ready" && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Processed WebP renditions are ready. Only published
                      products expose them.
                    </p>
                  )}
                  {(item.status === "uploading" ||
                    item.status === "quarantined" ||
                    item.status === "processing") && (
                    <div className="mt-3 grid gap-2">
                      <p className="text-sm text-warning">
                        Choose the same original file; the API verifies that its
                        content matches the recorded upload command.
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
                  {item.status === "deleting" && (
                    <p className="mt-2 text-sm text-warning">
                      Deletion is pending and can be retried safely.
                    </p>
                  )}
                </div>

                <div className="flex min-w-48 flex-col gap-2 sm:items-end">
                  {(item.status === "quarantined" ||
                    item.status === "ready" ||
                    item.status === "rejected") && (
                    <>
                      <label
                        className="w-full text-xs text-muted-foreground"
                        htmlFor={`delete-reason-${item.id}`}
                      >
                        Deletion reason
                      </label>
                      <Input
                        className="h-9 w-full"
                        disabled={operation !== null}
                        id={`delete-reason-${item.id}`}
                        maxLength={500}
                        minLength={3}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setDeletionReasons((current) => ({
                            ...current,
                            [item.id]: value,
                          }));
                        }}
                        placeholder="Reason for removal"
                        value={deletionReasons[item.id] ?? ""}
                      />
                      <Button
                        disabled={
                          operation !== null ||
                          (deletionReasons[item.id] ?? "").trim().length < 3
                        }
                        onClick={() =>
                          void deleteMedia(
                            item,
                            deletionReasons[item.id]?.trim() ?? "",
                          )
                        }
                        type="button"
                        variant="destructive"
                      >
                        {operation === `delete:${item.id}`
                          ? "Deleting…"
                          : "Delete media"}
                      </Button>
                    </>
                  )}
                  {item.status === "deleting" && (
                    <Button
                      disabled={operation !== null || !item.deletionReason}
                      onClick={() =>
                        item.deletionReason &&
                        void deleteMedia(item, item.deletionReason)
                      }
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
                    <p className="text-right text-xs text-muted-foreground">
                      Finish or retry processing before deleting.
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
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
