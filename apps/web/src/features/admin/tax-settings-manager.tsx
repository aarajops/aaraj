"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import {
  API_V1_BASE_PATH,
  ApiErrorResponseSchema,
  TaxSettingsSchema,
  TaxSettingsUpdateSchema,
  type TaxSettings,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";

export function TaxSettingsManager() {
  const [settings, setSettings] = useState<TaxSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch(`${API_V1_BASE_PATH}/tax/manage`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok)
          throw responseMessage(body, "Tax settings could not be loaded.");
        const result = TaxSettingsSchema.safeParse(body);
        if (!result.success)
          throw new Error("The server returned invalid tax settings.");
        if (active) {
          setSettings(result.data);
          setEnabled(result.data.enabled);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Tax settings could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || saving || enabled === settings.enabled) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const input = TaxSettingsUpdateSchema.parse({
        enabled,
        reason,
      });
      const response = await fetch(`${API_V1_BASE_PATH}/tax/manage`, {
        method: "PUT",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          responseMessage(body, "The tax setting could not be saved."),
        );
      }
      const result = TaxSettingsSchema.safeParse(body);
      if (!result.success)
        throw new Error("The server returned invalid tax settings.");
      setSettings(result.data);
      setEnabled(result.data.enabled);
      setReason("");
      setSaved(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The tax setting could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  const canEnable = Boolean(settings?.approvedProfileAvailable);
  const settingUnavailable = Boolean(
    settings && !settings.enabled && !canEnable,
  );
  const changed = Boolean(settings && enabled !== settings.enabled);

  return (
    <section className="mt-8 rounded-2xl border border-border p-5 sm:p-7">
      <h2 className="text-xl font-semibold">Tax calculation</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        When off, customer totals use the listed merchandise prices plus the
        delivery charge. The system does not calculate or add a tax amount.
      </p>

      {error && (
        <p
          className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
      {saved && (
        <p
          className="mt-5 rounded-lg border border-emerald-600/30 bg-emerald-600/10 p-3 text-sm"
          role="status"
        >
          Tax setting saved. New quotes will use this setting; existing orders
          keep their saved totals.
        </p>
      )}

      {loading ? (
        <p className="mt-6" role="status">
          Loading tax setting…
        </p>
      ) : settings ? (
        <form
          className="mt-6 grid gap-5"
          onSubmit={(event) => void save(event)}
        >
          <Field
            className={`flex items-start gap-3 rounded-xl border border-border p-4 ${
              settingUnavailable ? "cursor-not-allowed opacity-60" : ""
            }`}
          >
            <Checkbox
              id="tax-calculation-enabled"
              checked={enabled}
              className="mt-1"
              disabled={saving || settingUnavailable}
              aria-describedby={
                settingUnavailable ? "tax-profile-required" : undefined
              }
              onCheckedChange={(checked) => setEnabled(checked)}
            />
            <FieldLabel
              className={`flex-1 ${settingUnavailable ? "cursor-not-allowed" : "cursor-pointer"}`}
              htmlFor="tax-calculation-enabled"
            >
              <span className="block font-medium">
                {settings.enabled
                  ? "Tax calculation is on"
                  : "Tax calculation is off"}
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">
                {settings.enabled
                  ? "New quotes calculate tax from the active approved profile."
                  : "New quotes do not calculate or add tax."}
              </span>
            </FieldLabel>
          </Field>

          {settingUnavailable && (
            <p
              id="tax-profile-required"
              className="text-sm text-muted-foreground"
            >
              Tax calculation is unavailable until an approved current tax
              profile is configured. It remains off, so checkout uses listed
              prices and the delivery charge.
            </p>
          )}

          {changed && (
            <>
              <label className="grid gap-2 text-sm font-medium">
                Reason for this change
                <textarea
                  className="min-h-24 rounded-lg border border-input bg-background px-3 py-2 font-normal"
                  maxLength={500}
                  minLength={3}
                  required
                  value={reason}
                  onChange={(event) => setReason(event.currentTarget.value)}
                />
              </label>
              <div>
                <Button
                  disabled={
                    saving ||
                    reason.trim().length < 3 ||
                    (enabled && !canEnable)
                  }
                  type="submit"
                >
                  {saving ? "Saving…" : "Save tax setting"}
                </Button>
              </div>
            </>
          )}
        </form>
      ) : null}
    </section>
  );
}

function responseMessage(body: unknown, fallback: string): string {
  const result = ApiErrorResponseSchema.safeParse(body);
  if (!result.success) return fallback;
  if (result.data.errorCode === "TAX_PROFILE_REQUIRED") {
    return "An approved current tax profile must be configured before tax can be enabled.";
  }
  return Array.isArray(result.data.message)
    ? result.data.message.join(" ")
    : result.data.message;
}
