"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  useActiveTooltipCoordinate,
  useActiveTooltipDataPoints,
  useActiveTooltipLabel,
  useIsTooltipActive,
  usePlotArea,
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
        <Area
          activeDot={{ r: 4, fill: "var(--brand)", stroke: "var(--card)" }}
          dataKey="ordersPlaced"
          fill="url(#orders-fill)"
          stroke="var(--brand)"
          strokeWidth={2}
          type="monotone"
        />
        <ActivityTooltip />
      </AreaChart>
    </div>
  );
}

function ActivityTooltip() {
  const active = useIsTooltipActive();
  const coordinate = useActiveTooltipCoordinate();
  const label = useActiveTooltipLabel();
  const dataPoints =
    useActiveTooltipDataPoints<DashboardOverview["daily"][number]>();
  const plotArea = usePlotArea();
  const dataPoint = dataPoints?.[0];

  if (!active || !coordinate || label == null || !dataPoint || !plotArea) {
    return null;
  }

  const width = 160;
  const height = 56;
  const x = Math.max(
    plotArea.x,
    Math.min(coordinate.x + 12, plotArea.x + plotArea.width - width),
  );
  const y = Math.max(
    plotArea.y,
    Math.min(coordinate.y - height - 12, plotArea.y + plotArea.height - height),
  );

  return (
    <g pointerEvents="none">
      <line
        stroke="var(--muted-foreground)"
        strokeDasharray="3 3"
        strokeOpacity={0.6}
        x1={coordinate.x}
        x2={coordinate.x}
        y1={plotArea.y}
        y2={plotArea.y + plotArea.height}
      />
      <foreignObject height={height} width={width} x={x} y={y}>
        <div className="w-40 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md">
          <p className="font-medium">{formatDate(String(label), true)}</p>
          <p className="mt-1 text-primary">
            Orders placed: {count.format(dataPoint.ordersPlaced)} orders
          </p>
        </div>
      </foreignObject>
    </g>
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
