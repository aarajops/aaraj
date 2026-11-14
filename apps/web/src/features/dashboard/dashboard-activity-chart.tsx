"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardOverview } from "@aaraj/contracts";

const count = new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 });
const dateLabel = new Intl.DateTimeFormat("en-BD", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Dhaka",
});

export function DashboardActivityChart({
  data,
}: {
  data: DashboardOverview["daily"];
}) {
  return (
    <div className="h-[18rem] w-full sm:h-[21rem]">
      <AreaChart
        accessibilityLayer
        className="h-full w-full"
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: -20 }}
        responsive
      >
        <defs>
          <linearGradient id="orders-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.28} />
            <stop offset="95%" stopColor="var(--brand)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid
          vertical={false}
          stroke="var(--border)"
          strokeDasharray="3 3"
        />
        <XAxis
          axisLine={false}
          dataKey="date"
          minTickGap={24}
          tickFormatter={(value) => formatDate(String(value))}
          tickLine={false}
          tickMargin={10}
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
        />
        <Tooltip
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            color: "var(--popover-foreground)",
            boxShadow: "0 4px 12px rgb(0 0 0 / 0.08)",
          }}
          cursor={{
            stroke: "var(--muted-foreground)",
            strokeDasharray: "3 3",
          }}
          formatter={(value) => [
            `${count.format(Number(value))} orders`,
            "Orders placed",
          ]}
          labelFormatter={(value) => formatDate(String(value), true)}
        />
        <Area
          activeDot={{ r: 4, fill: "var(--brand)", stroke: "var(--card)" }}
          dataKey="ordersPlaced"
          fill="url(#orders-fill)"
          stroke="var(--brand)"
          strokeWidth={2}
          type="monotone"
        />
      </AreaChart>
    </div>
  );
}

function formatDate(value: string, includeYear = false): string {
  if (!value) return "";
  const formatter = includeYear
    ? new Intl.DateTimeFormat("en-BD", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Dhaka",
      })
    : dateLabel;
  return formatter.format(new Date(`${value}T12:00:00+06:00`));
}
