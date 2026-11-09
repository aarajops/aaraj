"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { TZDate, type DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

const ORDER_TIME_ZONE = "Asia/Dhaka";
const MINUTE_IN_MS = 60_000;
const dateTimeFormatter = new Intl.DateTimeFormat("en-BD", {
  timeZone: ORDER_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type OrdersCreatedRangeFilterProps = {
  createdFrom?: string;
  createdBefore?: string;
  onChange: (
    updates: Readonly<Record<string, string | number | undefined>>,
  ) => void;
};

type RangeDraft = {
  dates: DateRange | undefined;
  startTime: string;
  endTime: string;
};

export function OrdersCreatedRangeFilter({
  createdFrom,
  createdBefore,
  onChange,
}: OrdersCreatedRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RangeDraft>(() =>
    createDraft(createdFrom, createdBefore),
  );
  const hasRange = Boolean(createdFrom && createdBefore);
  const start = draft.dates?.from
    ? dateAtTime(draft.dates.from, draft.startTime)
    : undefined;
  const end = draft.dates?.to
    ? dateAtTime(draft.dates.to, draft.endTime)
    : undefined;
  const isValidRange = Boolean(
    start && end && start.getTime() <= end.getTime(),
  );
  const rangeError =
    draft.dates?.from && draft.dates?.to && start && end && !isValidRange
      ? "End must be at or after start."
      : undefined;
  const rangeMessage =
    rangeError ??
    (!draft.dates?.from || !draft.dates?.to
      ? "Select a start and end date."
      : !start || !end
        ? "Enter a start and end time."
        : undefined);
  const label =
    createdFrom && createdBefore
      ? `${dateTimeFormatter.format(new Date(createdFrom))} – ${dateTimeFormatter.format(new Date(Date.parse(createdBefore) - MINUTE_IN_MS))}`
      : "Placed date";

  function updateDraft(updates: Partial<RangeDraft>) {
    setDraft((current) => ({ ...current, ...updates }));
  }

  function applyRange() {
    if (!isValidRange || !start || !end) return;
    onChange({
      createdFrom: start.toISOString(),
      createdBefore: new Date(end.getTime() + MINUTE_IN_MS).toISOString(),
    });
    setOpen(false);
  }

  function clearRange() {
    onChange({ createdFrom: undefined, createdBefore: undefined });
    setDraft(createDraft(undefined, undefined));
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setDraft(createDraft(createdFrom, createdBefore));
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            aria-label="Filter orders by placed date and time"
            className="h-9 w-full justify-start gap-2 font-normal sm:w-auto"
            type="button"
            variant="outline"
          />
        }
      >
        <CalendarDays aria-hidden="true" className="text-muted-foreground" />
        <span className={hasRange ? undefined : "text-muted-foreground"}>
          {label}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <PopoverHeader className="flex-row items-center justify-between gap-2 px-3 pt-3">
          <PopoverTitle>Date range</PopoverTitle>
          <PopoverDescription className="text-xs">
            Dhaka time
          </PopoverDescription>
        </PopoverHeader>
        <Calendar
          defaultMonth={draft.dates?.from ?? TZDate.tz(ORDER_TIME_ZONE)}
          mode="range"
          selected={draft.dates}
          timeZone={ORDER_TIME_ZONE}
          onSelect={(dates) =>
            updateDraft({
              dates: dates
                ? {
                    from: dates.from
                      ? TZDate.tz(ORDER_TIME_ZONE, dates.from)
                      : undefined,
                    to: dates.to
                      ? TZDate.tz(ORDER_TIME_ZONE, dates.to)
                      : undefined,
                  }
                : undefined,
            })
          }
        />
        <div className="grid grid-cols-2 gap-3 border-t px-3 py-3">
          <label
            className="grid gap-1.5 text-sm font-medium"
            htmlFor="orders-created-start-time"
          >
            Start time
            <Input
              id="orders-created-start-time"
              aria-label="Start time"
              className="h-9"
              step={MINUTE_IN_MS / 1000}
              type="time"
              value={draft.startTime}
              onChange={(event) =>
                updateDraft({ startTime: event.target.value })
              }
            />
          </label>
          <label
            className="grid gap-1.5 text-sm font-medium"
            htmlFor="orders-created-end-time"
          >
            End time
            <Input
              id="orders-created-end-time"
              aria-label="End time"
              className="h-9"
              step={MINUTE_IN_MS / 1000}
              type="time"
              value={draft.endTime}
              onChange={(event) => updateDraft({ endTime: event.target.value })}
            />
          </label>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
          {rangeMessage && (
            <p
              aria-live="polite"
              className={
                rangeError
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {rangeMessage}
            </p>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {hasRange && (
              <Button type="button" variant="ghost" onClick={clearRange}>
                Clear
              </Button>
            )}
            <Button type="button" disabled={!isValidRange} onClick={applyRange}>
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function createDraft(createdFrom?: string, createdBefore?: string): RangeDraft {
  if (!createdFrom || !createdBefore) {
    return { dates: undefined, startTime: "00:00", endTime: "23:59" };
  }

  const start = TZDate.tz(ORDER_TIME_ZONE, new Date(createdFrom));
  const inclusiveEnd = TZDate.tz(
    ORDER_TIME_ZONE,
    new Date(Date.parse(createdBefore) - MINUTE_IN_MS),
  );
  return {
    dates: { from: start, to: inclusiveEnd },
    startTime: formatTime(start),
    endTime: formatTime(inclusiveEnd),
  };
}

function dateAtTime(date: Date, time: string): TZDate | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;

  const dhakaDate = TZDate.tz(ORDER_TIME_ZONE, date);
  return TZDate.tz(
    ORDER_TIME_ZONE,
    dhakaDate.getFullYear(),
    dhakaDate.getMonth(),
    dhakaDate.getDate(),
    hours,
    minutes,
  );
}

function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
