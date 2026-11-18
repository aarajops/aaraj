"use client";

import {
  CatalogMeasurementKeySchema,
  type CatalogSizeGuide,
} from "@aaraj/contracts";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { catalogMeasurementLabels } from "@/features/catalog/size-guide-labels";
import { CircleHelp } from "lucide-react";

export function SizeGuideTable({ sizeGuide }: { sizeGuide: CatalogSizeGuide }) {
  const configuredMeasurementKeys = new Set(
    sizeGuide.rows[0]?.measurements.map(({ key }) => key) ?? [],
  );
  const measurementKeys = CatalogMeasurementKeySchema.options.filter((key) =>
    configuredMeasurementKeys.has(key),
  );

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Size guide</h3>
      <div className="overflow-hidden rounded-lg border border-border">
        <Table
          aria-describedby="size-guide-measurement-basis"
          className="min-w-max border-collapse text-left"
        >
          <TableCaption className="sr-only">
            Size measurements in inches
          </TableCaption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-auto px-3 py-2" scope="col">
                Measurement
              </TableHead>
              {sizeGuide.rows.map((row) => (
                <TableHead
                  className="h-auto px-3 py-2"
                  key={row.id}
                  scope="col"
                >
                  {row.sizeLabel}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {measurementKeys.map((key) => (
              <TableRow className="hover:bg-transparent" key={key}>
                <TableHead className="h-auto px-3 py-2 font-medium" scope="row">
                  {catalogMeasurementLabels[key].replace(
                    / (width|length)$/,
                    "",
                  )}
                </TableHead>
                {sizeGuide.rows.map((row) => {
                  const measurement = row.measurements.find(
                    (item) => item.key === key,
                  );
                  return (
                    <TableCell
                      className="px-3 py-2 text-muted-foreground"
                      key={row.id}
                    >
                      {measurement
                        ? formatMeasurement(measurement.valueIn)
                        : "—"}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end gap-1 text-xs leading-none text-muted-foreground">
        <span id="size-guide-measurement-basis">
          {sizeGuide.measurementBasis === "garment" ? "Garment" : "Body"}{" "}
          measurements in inches
        </span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="About size measurements"
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <CircleHelp aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent>
              {sizeGuide.measurementBasis === "garment"
                ? "Measurements are in inches and describe the garment, not body measurements."
                : "Measurements are in inches and describe body measurements, not garment dimensions."}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

function formatMeasurement(valueIn: string): string {
  const [whole, fraction = ""] = valueIn.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : (whole ?? valueIn);
}
