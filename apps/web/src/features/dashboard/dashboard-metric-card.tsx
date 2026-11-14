import type { ReactNode } from "react";
import {
  BadgeCheck,
  Banknote,
  CircleHelp,
  ClipboardList,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function DashboardMetricsLoading() {
  return (
    <section
      aria-label="Business summary"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <MetricCard icon={ShoppingBag} title="Orders placed" value={null} />
      <MetricCard
        help="Current value of non-cancelled orders in this period. This is not cash collected."
        icon={Banknote}
        title="COD order value"
        value={null}
      />
      <MetricCard
        help="Net total of recorded COD reconciliation changes in this period. It can be negative."
        icon={BadgeCheck}
        title="COD reconciled"
        value={null}
      />
      <MetricCard icon={ClipboardList} title="Needs action" value={null} />
    </section>
  );
}

export function MetricCard({
  title,
  value,
  detail,
  help,
  icon: Icon,
}: {
  title: string;
  value: ReactNode;
  detail?: ReactNode;
  help?: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="relative min-h-36">
      <CardHeader className="relative z-10 gap-3">
        <div className="flex min-h-6 items-center gap-1">
          <div className="flex min-w-0 items-center gap-1">
            <CardDescription className="text-muted-foreground/75">
              {title}
            </CardDescription>
            {help && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={`About ${title}`}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <CircleHelp aria-hidden="true" />
                    </Button>
                  }
                />
                <TooltipContent>{help}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <CardTitle className="min-h-10 text-4xl tabular-nums">
          {value}
        </CardTitle>
        {detail && <p className="text-sm text-muted-foreground/70">{detail}</p>}
      </CardHeader>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-4 end-4 z-0 flex items-center justify-center opacity-5"
      >
        <Icon size={50} strokeWidth={2} />
      </span>
    </Card>
  );
}
