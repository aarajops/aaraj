"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useFieldArray,
  useForm,
  useWatch,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { z } from "zod";
import {
  API_V1_BASE_PATH,
  ApiErrorResponseSchema,
  BangladeshGeographySchema,
  DeliveryAreaRuleSchema,
  DeliveryTariffManagementSchema,
  DeliveryTariffUpdateSchema,
  type BangladeshGeography,
  type DeliveryAreaRule,
  type DeliveryTariffManagement,
  type DeliveryTariffUpdate,
  type DeliveryZone,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatCatalogPrice } from "@/features/catalog/price";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "cn";

const feeInputSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{0,9}$/, "Enter a whole BDT amount.")
  .transform(Number)
  .pipe(z.number().int().min(1).max(2_147_483_647));

const deliveryTariffFormSchema = z
  .strictObject({
    geographyVersion: z.string().min(1),
    fees: z.strictObject({
      insideDhakaBdt: feeInputSchema,
      suburbanBdt: feeInputSchema,
      outsideDhakaBdt: feeInputSchema,
    }),
    areaRules: z.array(DeliveryAreaRuleSchema),
    reason: z.string().trim().min(3, "Add a reason for this tariff.").max(500),
  })
  .superRefine((value, context) => {
    const result = DeliveryTariffUpdateSchema.safeParse(value);
    if (result.success) return;
    for (const issue of result.error.issues) {
      context.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    }
  });

type DeliveryTariffDraft = z.input<typeof deliveryTariffFormSchema>;
type DeliveryTariffFormValues = z.output<typeof deliveryTariffFormSchema>;

const zoneOptions: { value: DeliveryZone; label: string }[] = [
  { value: "inside_dhaka", label: "Inside Dhaka" },
  { value: "suburban", label: "Suburban" },
  { value: "outside_dhaka", label: "Outside Dhaka" },
];
const ALL_UPAZILAS_OPTION = "all-upazilas";

export function DeliveryTariffManager() {
  const [settings, setSettings] = useState<DeliveryTariffManagement | null>(
    null,
  );
  const [geography, setGeography] = useState<BangladeshGeography | null>(null);
  const [divisionId, setDivisionId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [upazilaId, setUpazilaId] = useState("");
  const [zone, setZone] = useState<DeliveryZone | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    register,
    reset,
    formState: { errors },
  } = useForm<DeliveryTariffDraft, unknown, DeliveryTariffFormValues>({
    resolver: zodResolver(deliveryTariffFormSchema),
    defaultValues: emptyDraft(),
  });
  const {
    fields: areaRules,
    append,
    remove,
  } = useFieldArray({ control, name: "areaRules" });
  const fees = useWatch({ control, name: "fees" });
  const divisionOptions = useMemo(
    () =>
      geography?.locations.filter(({ level }) => level === "division") ?? [],
    [geography],
  );
  const districtOptions = useMemo(
    () =>
      geography?.locations.filter(
        ({ level, parentId }) =>
          level === "district" && parentId === divisionId,
      ) ?? [],
    [divisionId, geography],
  );
  const upazilaOptions = useMemo(
    () =>
      geography?.locations.filter(
        ({ level, parentId }) => level === "upazila" && parentId === districtId,
      ) ?? [],
    [districtId, geography],
  );
  const locationById = useMemo(
    () =>
      new Map(geography?.locations.map((location) => [location.id, location])),
    [geography],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch(`${API_V1_BASE_PATH}/delivery/manage`, {
        cache: "no-store",
        credentials: "same-origin",
      }).then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(
            responseMessage(body, "Delivery rates could not be loaded."),
          );
        const result = DeliveryTariffManagementSchema.safeParse(body);
        if (!result.success)
          throw new Error("The server returned invalid delivery settings.");
        return result.data;
      }),
      fetch(`${API_V1_BASE_PATH}/geography`, {
        cache: "no-store",
        credentials: "same-origin",
      }).then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(
            responseMessage(body, "Delivery areas could not be loaded."),
          );
        const result = BangladeshGeographySchema.safeParse(body);
        if (!result.success)
          throw new Error("The server returned invalid Bangladesh geography.");
        return result.data;
      }),
    ])
      .then(([loadedSettings, loadedGeography]) => {
        if (!active) return;
        if (
          loadedSettings.geographyVersion !== loadedGeography.datasetVersion
        ) {
          throw new Error(
            "Bangladesh delivery areas changed. Reload the page and try again.",
          );
        }
        setSettings(loadedSettings);
        setGeography(loadedGeography);
        reset(toDraft(loadedSettings, loadedGeography.datasetVersion));
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Delivery settings could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reset]);

  async function save(values: DeliveryTariffFormValues) {
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const input: DeliveryTariffUpdate =
        DeliveryTariffUpdateSchema.parse(values);
      const response = await fetch(`${API_V1_BASE_PATH}/delivery/manage`, {
        method: "PUT",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          responseMessage(body, "The delivery tariff could not be saved."),
        );
      const result = DeliveryTariffManagementSchema.safeParse(body);
      if (!result.success)
        throw new Error("The server returned invalid delivery settings.");
      setSettings(result.data);
      reset(
        toDraft(
          result.data,
          geography?.datasetVersion ?? result.data.geographyVersion,
        ),
      );
      setNotice(
        "Delivery rates updated. New quotes will use them immediately.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The delivery tariff could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  function addAreaRule() {
    if (!districtId || !zone) {
      setError("Choose a district and delivery zone first.");
      return;
    }
    const locationId = upazilaId || districtId;
    if (areaRules.some((rule) => rule.locationId === locationId)) {
      setError("That location already has a zone rule.");
      return;
    }
    const districtDefaultZone =
      areaRules.find((rule) => rule.locationId === districtId)?.zone ??
      "outside_dhaka";
    if (zone === districtDefaultZone) {
      setError(
        upazilaId
          ? "This upazila already uses its district's delivery rate. No override is needed."
          : "Outside Dhaka is the default rate. No district rule is needed.",
      );
      return;
    }
    setError(null);
    append({
      locationId,
      level: upazilaId ? "upazila" : "district",
      zone,
    });
  }

  return (
    <section className="mt-8 grid gap-6">
      {error && <Message kind="error">{error}</Message>}
      {notice && <Message kind="notice">{notice}</Message>}

      {loading ? (
        <p role="status">Loading delivery settings…</p>
      ) : settings && geography ? (
        <form className="grid gap-8" onSubmit={handleSubmit(save)}>
          <input type="hidden" {...register("geographyVersion")} />

          {settings.current.pricingModel === "district" && (
            <Message kind="warning">
              Existing district rates are still active. Enter zone rates and
              save to switch pricing to zones; the old district amounts cannot
              be safely converted into zone rates automatically.
            </Message>
          )}

          {settings.current.pricingModel === "zones" &&
            !areaRules.some((rule) => rule.zone !== "outside_dhaka") && (
              <Message kind="warning">
                No areas use Inside Dhaka or Suburban yet. Every delivery quote
                currently uses the Outside Dhaka rate.
              </Message>
            )}

          <div className="grid gap-4">
            <div>
              <h2 className="font-semibold">Zone rates</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Set the delivery fee for each zone. Area rules assign a zone to
                a district or upazila.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <FeeField
                id="delivery-fee-inside-dhaka"
                label="Inside Dhaka (৳)"
                register={register("fees.insideDhakaBdt")}
                error={errors.fees?.insideDhakaBdt?.message}
              />
              <FeeField
                id="delivery-fee-suburban"
                label="Suburban (৳)"
                register={register("fees.suburbanBdt")}
                error={errors.fees?.suburbanBdt?.message}
              />
              <FeeField
                id="delivery-fee-outside-dhaka"
                label="Outside Dhaka (৳)"
                register={register("fees.outsideDhakaBdt")}
                error={errors.fees?.outsideDhakaBdt?.message}
              />
            </div>
          </div>

          <div className="grid gap-4">
            <div>
              <h2 className="font-semibold">Delivery areas</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A district rule sets its default; an upazila rule overrides it.
                Locations without a rule use Outside Dhaka.
              </p>
            </div>
            <p className="text-sm">
              <span className="font-medium">Default rate</span>
              <span className="text-muted-foreground">
                {" "}
                Outside Dhaka · {zoneFeeLabel("outside_dhaka", fees)}
              </span>
            </p>
            <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <PickerField id="delivery-area-division" label="Division">
                <Select
                  items={divisionOptions.map(({ id, name }) => ({
                    value: id,
                    label: name,
                  }))}
                  value={divisionId || null}
                  onValueChange={(value) => {
                    setDivisionId(value ?? "");
                    setDistrictId("");
                    setUpazilaId("");
                  }}
                >
                  <SelectTrigger id="delivery-area-division">
                    <SelectValue placeholder="Choose division" />
                  </SelectTrigger>
                  <SelectContent>
                    {divisionOptions.map((division) => (
                      <SelectItem key={division.id} value={division.id}>
                        {division.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PickerField>
              <PickerField id="delivery-area-district" label="District">
                <Select
                  items={districtOptions.map(({ id, name }) => ({
                    value: id,
                    label: name,
                  }))}
                  value={districtId || null}
                  disabled={!divisionId}
                  onValueChange={(value) => {
                    setDistrictId(value ?? "");
                    setUpazilaId("");
                  }}
                >
                  <SelectTrigger id="delivery-area-district">
                    <SelectValue placeholder="Choose district" />
                  </SelectTrigger>
                  <SelectContent>
                    {districtOptions.map((district) => (
                      <SelectItem key={district.id} value={district.id}>
                        {district.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PickerField>
              <PickerField
                id="delivery-area-upazila"
                label="Upazila (optional)"
              >
                <Select
                  items={[
                    { value: ALL_UPAZILAS_OPTION, label: "All upazilas" },
                    ...upazilaOptions.map(({ id, name }) => ({
                      value: id,
                      label: name,
                    })),
                  ]}
                  value={upazilaId || null}
                  disabled={!districtId}
                  onValueChange={(value) =>
                    setUpazilaId(
                      value === ALL_UPAZILAS_OPTION ? "" : (value ?? ""),
                    )
                  }
                >
                  <SelectTrigger id="delivery-area-upazila">
                    <SelectValue placeholder="All upazilas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_UPAZILAS_OPTION}>
                      All upazilas
                    </SelectItem>
                    {upazilaOptions.map((upazila) => (
                      <SelectItem key={upazila.id} value={upazila.id}>
                        {upazila.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PickerField>
              <PickerField id="delivery-area-zone" label="Zone">
                <Select
                  items={zoneOptions}
                  value={zone ?? null}
                  onValueChange={(value) => {
                    setZone(
                      zoneOptions.find((option) => option.value === value)
                        ?.value ?? null,
                    );
                  }}
                >
                  <SelectTrigger id="delivery-area-zone">
                    <SelectValue placeholder="Choose zone" />
                  </SelectTrigger>
                  <SelectContent>
                    {zoneOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PickerField>
              <Button
                className="w-full"
                disabled={!districtId || !zone || saving}
                onClick={addAreaRule}
                type="button"
                variant="outline"
              >
                Add area rule
              </Button>
            </div>

            {areaRules.length > 0 ? (
              <ul className="divide-y divide-border border-y border-border">
                {areaRules.map((rule, index) => (
                  <li
                    className="flex items-center justify-between gap-4 py-3 text-sm"
                    key={rule.id}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {formatAreaName(rule.locationId, locationById)}
                      </span>
                      <span className="text-muted-foreground">
                        {zoneLabel(rule.zone)} · {zoneFeeLabel(rule.zone, fees)}
                      </span>
                    </span>
                    <Button
                      aria-label={`Remove ${formatAreaName(rule.locationId, locationById)} zone rule`}
                      disabled={saving}
                      onClick={() => remove(index)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No area overrides set.
              </p>
            )}
            {errors.areaRules?.message && (
              <FieldError>{errors.areaRules.message}</FieldError>
            )}
          </div>

          <Field className="max-w-2xl">
            <FieldLabel htmlFor="delivery-tariff-reason">
              Change reason
            </FieldLabel>
            <Input
              id="delivery-tariff-reason"
              maxLength={500}
              placeholder="For example, approved delivery rate update"
              aria-invalid={Boolean(errors.reason)}
              aria-describedby={
                errors.reason ? "delivery-tariff-reason-error" : undefined
              }
              {...register("reason")}
            />
            <FieldDescription>
              Saved with the tariff audit record.
            </FieldDescription>
            {errors.reason?.message && (
              <FieldError id="delivery-tariff-reason-error">
                {errors.reason.message}
              </FieldError>
            )}
          </Field>

          <div>
            <Button disabled={saving} size="lg" type="submit">
              {saving ? "Saving…" : "Save delivery rates"}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function FeeField({
  id,
  label,
  register,
  error,
}: {
  id: string;
  label: string;
  register: UseFormRegisterReturn;
  error?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        min={1}
        max={2_147_483_647}
        step={1}
        inputMode="numeric"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...register}
      />
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </Field>
  );
}

function PickerField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
    </Field>
  );
}

function Message({
  kind,
  children,
}: {
  kind: "error" | "notice" | "warning";
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "border px-3 py-2 text-sm",
        kind === "error"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : kind === "warning"
            ? "border-amber-600/30 bg-amber-500/5 text-foreground"
            : "border-border text-foreground",
      )}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}

function emptyDraft(geographyVersion = ""): DeliveryTariffDraft {
  return {
    geographyVersion,
    fees: {
      insideDhakaBdt: "",
      suburbanBdt: "",
      outsideDhakaBdt: "",
    },
    areaRules: [],
    reason: "",
  };
}

function toDraft(
  settings: DeliveryTariffManagement,
  geographyVersion: string,
): DeliveryTariffDraft {
  const plan = settings.current;
  if (!plan.fees) {
    return emptyDraft(geographyVersion);
  }
  return {
    geographyVersion,
    fees: {
      insideDhakaBdt: String(plan.fees.insideDhakaBdt),
      suburbanBdt: String(plan.fees.suburbanBdt),
      outsideDhakaBdt: String(plan.fees.outsideDhakaBdt),
    },
    areaRules: plan.areaRules,
    reason: "",
  };
}

function formatAreaName(
  locationId: string,
  locations: Map<string, BangladeshGeography["locations"][number]>,
): string {
  const location = locations.get(locationId);
  if (!location) return "Unavailable location";
  const parent = location.parentId ? locations.get(location.parentId) : null;
  const division =
    parent?.level === "district" && parent.parentId
      ? locations.get(parent.parentId)
      : parent;
  return [
    division?.name,
    parent?.level === "district" ? parent.name : null,
    location.name,
  ]
    .filter(Boolean)
    .join(" · ");
}

function zoneLabel(zone: DeliveryAreaRule["zone"]): string {
  return zoneOptions.find((option) => option.value === zone)?.label ?? zone;
}

function zoneFeeLabel(
  zone: DeliveryZone,
  fees: DeliveryTariffDraft["fees"] | undefined,
): string {
  const value =
    zone === "inside_dhaka"
      ? fees?.insideDhakaBdt
      : zone === "suburban"
        ? fees?.suburbanBdt
        : fees?.outsideDhakaBdt;
  const parsedFee = feeInputSchema.safeParse(value);
  return parsedFee.success
    ? formatCatalogPrice({ amountBdt: parsedFee.data })
    : "Rate not set";
}

function responseMessage(body: unknown, fallback: string): string {
  const result = ApiErrorResponseSchema.safeParse(body);
  if (!result.success) return fallback;
  return Array.isArray(result.data.message)
    ? result.data.message.join(" ")
    : result.data.message;
}
