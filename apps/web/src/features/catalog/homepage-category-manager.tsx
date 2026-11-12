"use client";

import { useState } from "react";
import {
  StorefrontSettingsSchema,
  type CatalogCategoryOption,
  type StorefrontSettings,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { HomepageCategorySettings } from "@/features/catalog/homepage-category-settings";
import {
  fetchManagedStorefrontSettings,
  updateManagedStorefrontSettings,
} from "@/features/storefront/admin/storefront-management-client";
import {
  storefrontSettingsFormSchema,
  toStorefrontSettingsDraft,
} from "@/features/storefront/admin/storefront-settings-form";
import {
  getApiErrorMessage,
  readApiErrorResponse,
} from "@/lib/api-error-response";

export function HomepageCategoryManager({
  categories,
}: {
  categories: CatalogCategoryOption[];
}) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<StorefrontSettings | null>(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function loadSettings() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchManagedStorefrontSettings();
      if (!response.ok) {
        const problem = await readApiErrorResponse(response);
        throw new Error(
          getApiErrorMessage(problem) ??
            "Homepage category settings could not be loaded.",
        );
      }
      const body: unknown = await response.json().catch(() => null);
      const result = StorefrontSettingsSchema.safeParse(body);
      if (!result.success) {
        throw new Error("The server returned invalid storefront settings.");
      }
      setSettings(result.data);
      setSelectedCategoryIds(result.data.homepageCategoryIds);
      setEnabled(result.data.homepageCategoriesEnabled);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Homepage category settings could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    setError(null);
    setStatus(null);

    if (nextOpen && !settings && !loading) {
      void loadSettings();
      return;
    }

    if (!nextOpen && settings) {
      setSelectedCategoryIds(settings.homepageCategoryIds);
      setEnabled(settings.homepageCategoriesEnabled);
    }
  }

  const hasChanges =
    settings !== null &&
    (enabled !== settings.homepageCategoriesEnabled ||
      selectedCategoryIds.length !== settings.homepageCategoryIds.length ||
      selectedCategoryIds.some(
        (categoryId, index) =>
          categoryId !== settings.homepageCategoryIds[index],
      ));

  async function save() {
    if (!settings || !hasChanges || saving) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const input = storefrontSettingsFormSchema.parse({
        ...toStorefrontSettingsDraft(settings),
        homepageCategoryIds: selectedCategoryIds,
        homepageCategoriesEnabled: enabled,
      });
      const response = await updateManagedStorefrontSettings(input);
      if (!response.ok) {
        const problem = await readApiErrorResponse(response);
        throw new Error(
          getApiErrorMessage(problem) ??
            "Homepage categories could not be saved.",
        );
      }
      const result = StorefrontSettingsSchema.safeParse(await response.json());
      if (!result.success) {
        throw new Error("The server returned invalid storefront settings.");
      }
      setSettings(result.data);
      setSelectedCategoryIds(result.data.homepageCategoryIds);
      setEnabled(result.data.homepageCategoriesEnabled);
      setStatus("Homepage categories saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Homepage categories could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetTrigger render={<Button size="lg" variant="outline" />}>
        Homepage categories
      </SheetTrigger>
      <SheetContent className="gap-0 sm:max-w-lg">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Homepage categories</SheetTitle>
          <SheetDescription>
            Choose which categories appear on the homepage and set their order.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {loading && !settings ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading homepage settings…
            </p>
          ) : settings ? (
            <>
              <HomepageCategorySettings
                categories={categories}
                selectedCategoryIds={selectedCategoryIds}
                enabled={enabled}
                disabled={saving}
                onEnabledChange={(value) => {
                  setEnabled(value);
                  setError(null);
                  setStatus(null);
                }}
                onCategoryAdd={(categoryId) => {
                  if (saving || selectedCategoryIds.includes(categoryId))
                    return;
                  setSelectedCategoryIds((current) => [...current, categoryId]);
                  setError(null);
                  setStatus(null);
                }}
                onCategoryRemove={(categoryId) => {
                  if (saving) return;
                  setSelectedCategoryIds((current) =>
                    current.filter((id) => id !== categoryId),
                  );
                  setError(null);
                  setStatus(null);
                }}
                onCategoryMove={(fromIndex, toIndex) => {
                  if (saving) return;
                  setSelectedCategoryIds((current) => {
                    const next = [...current];
                    const [categoryId] = next.splice(fromIndex, 1);
                    if (categoryId === undefined) return current;
                    next.splice(toIndex, 0, categoryId);
                    return next;
                  });
                  setError(null);
                  setStatus(null);
                }}
              />
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              {status && (
                <p className="text-sm text-success" role="status">
                  {status}
                </p>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-destructive" role="alert">
                {error ?? "Homepage settings could not be loaded."}
              </p>
              <Button
                disabled={loading}
                onClick={() => void loadSettings()}
                type="button"
                variant="outline"
              >
                Try again
              </Button>
            </div>
          )}
        </div>

        {settings && (
          <SheetFooter className="mt-0 flex-row justify-end border-t">
            <Button
              disabled={!hasChanges || saving}
              onClick={() => void save()}
              type="button"
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
