"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import {
  API_V1_BASE_PATH,
  ApiErrorResponseSchema,
  StorefrontSettingsSchema,
  StorefrontSettingsUpdateSchema,
  type StorefrontSettings,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function StorefrontSettingsManager() {
  const [settings, setSettings] = useState<StorefrontSettings | null>(null);
  const [siteName, setSiteName] = useState("");
  const [announcementEnabled, setAnnouncementEnabled] = useState(false);
  const [announcementText, setAnnouncementText] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch(`${API_V1_BASE_PATH}/storefront/manage/settings`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            responseMessage(body, "Storefront settings could not be loaded."),
          );
        }
        const result = StorefrontSettingsSchema.safeParse(body);
        if (!result.success) {
          throw new Error("The server returned invalid storefront settings.");
        }
        if (active) {
          setSettings(result.data);
          setSiteName(result.data.siteName);
          setAnnouncementEnabled(result.data.announcementEnabled);
          setAnnouncementText(result.data.announcementText ?? "");
          setSupportPhone(result.data.supportPhone ?? "");
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Storefront settings could not be loaded.",
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

  const changed = Boolean(
    settings &&
    (siteName !== settings.siteName ||
      announcementEnabled !== settings.announcementEnabled ||
      announcementText !== (settings.announcementText ?? "") ||
      supportPhone !== (settings.supportPhone ?? "")),
  );

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || saving || !changed) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const input = StorefrontSettingsUpdateSchema.parse({
        siteName,
        announcementEnabled,
        announcementText: announcementText.trim() || null,
        supportPhone: supportPhone.trim() || null,
        expectedVersion: settings.version,
        reason,
      });
      const response = await fetch(
        `${API_V1_BASE_PATH}/storefront/manage/settings`,
        {
          method: "PUT",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          responseMessage(body, "Storefront settings could not be saved."),
        );
      }
      const result = StorefrontSettingsSchema.safeParse(body);
      if (!result.success) {
        throw new Error("The server returned invalid storefront settings.");
      }
      setSettings(result.data);
      setSiteName(result.data.siteName);
      setAnnouncementEnabled(result.data.announcementEnabled);
      setAnnouncementText(result.data.announcementText ?? "");
      setSupportPhone(result.data.supportPhone ?? "");
      setReason("");
      setSaved(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Storefront settings could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-border p-5 sm:p-7">
      <h2 className="text-xl font-semibold">Store identity and contact</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        These public settings are displayed in the storefront header. Changes
        take effect immediately after saving.
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
          Storefront settings saved and published.
        </p>
      )}

      {loading ? (
        <p className="mt-6" role="status">
          Loading storefront settings…
        </p>
      ) : settings ? (
        <form
          className="mt-6 grid gap-5"
          onSubmit={(event) => void save(event)}
        >
          <Field>
            <FieldLabel htmlFor="storefront-site-name">Store name</FieldLabel>
            <Input
              id="storefront-site-name"
              autoComplete="organization"
              maxLength={80}
              required
              value={siteName}
              onChange={(event) => setSiteName(event.currentTarget.value)}
            />
            <FieldDescription>
              Shown as the storefront brand name.
            </FieldDescription>
          </Field>

          <Field>
            <div className="flex items-center gap-3">
              <input
                id="storefront-announcement-enabled"
                checked={announcementEnabled}
                className="size-4 accent-primary"
                type="checkbox"
                onChange={(event) =>
                  setAnnouncementEnabled(event.currentTarget.checked)
                }
              />
              <FieldLabel htmlFor="storefront-announcement-enabled">
                Show announcement banner
              </FieldLabel>
            </div>
            <Textarea
              id="storefront-announcement-text"
              aria-label="Announcement text"
              maxLength={160}
              placeholder="Step into the festive season with AARAJ"
              value={announcementText}
              onChange={(event) =>
                setAnnouncementText(event.currentTarget.value)
              }
            />
            <FieldDescription>
              Plain text only, up to 160 characters. Leave it blank to remove
              the announcement when the banner is disabled.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="storefront-support-phone">
              Customer support phone
            </FieldLabel>
            <Input
              id="storefront-support-phone"
              autoComplete="tel"
              inputMode="tel"
              maxLength={16}
              pattern="\+[1-9][0-9]{7,14}"
              placeholder="+8801XXXXXXXXX"
              value={supportPhone}
              onChange={(event) => setSupportPhone(event.currentTarget.value)}
            />
            <FieldDescription>
              Optional. Use international E.164 format; the storefront renders a
              click-to-call link.
            </FieldDescription>
          </Field>

          {changed && (
            <>
              <Field>
                <FieldLabel htmlFor="storefront-change-reason">
                  Reason for this change
                </FieldLabel>
                <Textarea
                  id="storefront-change-reason"
                  maxLength={500}
                  minLength={3}
                  required
                  value={reason}
                  onChange={(event) => setReason(event.currentTarget.value)}
                />
              </Field>
              <div>
                <Button
                  disabled={
                    saving ||
                    reason.trim().length < 3 ||
                    (announcementEnabled && !announcementText.trim())
                  }
                  type="submit"
                >
                  {saving ? "Saving…" : "Save storefront settings"}
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
  if (result.data.errorCode === "STOREFRONT_SETTINGS_STALE") {
    return "These settings changed in another session. Reload this page and apply your change again.";
  }
  return Array.isArray(result.data.message)
    ? result.data.message.join(" ")
    : result.data.message;
}
