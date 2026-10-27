import Link from "next/link";
import type { Order } from "@aaraj/contracts";
import { buttonVariants } from "@/components/ui/button";
import { formatBdtPrice } from "@/lib/currency";
import { formatDateTime } from "@/lib/date-time";
import { OrderInvoicePrintButton } from "./order-invoice-print-button";

export function OrderInvoice({
  order,
  autoPrint,
}: {
  order: Order;
  autoPrint: boolean;
}) {
  const deliveryAddress = [
    order.address.house,
    order.address.street,
    order.address.locality,
    order.address.doorstepDetails,
    order.address.upazilaName,
    order.address.districtName,
    order.address.divisionName,
    order.address.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <main className="flex-1 bg-background px-5 py-8 text-foreground sm:px-8 sm:py-10 print:min-h-0 print:w-full print:bg-white print:px-0 print:py-0 print:text-black">
      <article className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-6 sm:p-10 print:max-w-none print:rounded-none print:border-0 print:bg-white print:p-0">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link
            className={buttonVariants({ size: "sm", variant: "outline" })}
            href={`/admin/orders/${order.id}`}
          >
            Back to order
          </Link>
          <OrderInvoicePrintButton autoPrint={autoPrint} />
        </div>

        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-border pb-6 print:border-black">
          <div>
            <p className="text-lg font-bold tracking-[0.16em] text-primary print:text-black">
              AARAJ
            </p>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight">
              Invoice
            </h1>
          </div>
          <dl className="grid gap-2 text-right text-sm">
            <div>
              <dt className="text-muted-foreground print:text-gray-600">
                Order number
              </dt>
              <dd className="font-semibold">{order.reference}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground print:text-gray-600">
                Order date
              </dt>
              <dd>{formatDateTime(order.createdAt)}</dd>
            </div>
          </dl>
        </header>

        <section className="grid gap-6 border-b border-border py-6 sm:grid-cols-2 print:border-black">
          <div>
            <h2 className="text-sm font-semibold">Bill to</h2>
            <p className="mt-2">{order.address.recipientName}</p>
            <p className="text-sm text-muted-foreground print:text-gray-700">
              {order.address.phone}
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold">Ship to</h2>
            <p className="mt-2">{deliveryAddress}</p>
            {order.address.instructions && (
              <p className="mt-1 text-sm text-muted-foreground print:text-gray-700">
                Delivery instructions: {order.address.instructions}
              </p>
            )}
          </div>
        </section>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="break-inside-avoid border-b border-border print:border-black">
                <th className="py-3 pr-3 font-semibold" scope="col">
                  Item
                </th>
                <th className="px-3 py-3 text-right font-semibold" scope="col">
                  Qty
                </th>
                <th className="px-3 py-3 text-right font-semibold" scope="col">
                  Unit price
                </th>
                <th className="py-3 pl-3 text-right font-semibold" scope="col">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr
                  className="break-inside-avoid border-b border-border print:border-gray-300"
                  key={line.variantId}
                >
                  <td className="py-3 pr-3">
                    <span className="font-medium">{line.productName}</span>
                    <span className="block text-muted-foreground print:text-gray-700">
                      {line.color} · {line.sizeLabel}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {line.quantity}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatBdtPrice({ amountBdt: line.unitPriceBdt })}
                  </td>
                  <td className="py-3 pl-3 text-right tabular-nums">
                    {formatBdtPrice({ amountBdt: line.grossAmountBdt })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto grid max-w-sm gap-2 pt-6 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground print:text-gray-700">
              Subtotal
            </dt>
            <dd className="tabular-nums">
              {formatBdtPrice({ amountBdt: order.merchandiseGrossBdt })}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground print:text-gray-700">
              Delivery
            </dt>
            <dd className="tabular-nums">
              {formatBdtPrice({ amountBdt: order.delivery.grossAmountBdt })}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-border pt-3 text-base font-semibold print:border-black">
            <dt>Order total</dt>
            <dd className="tabular-nums">
              {formatBdtPrice({ amountBdt: order.totalBdt })}
            </dd>
          </div>
        </dl>

        <p className="mt-8 border-t border-border pt-4 text-sm text-muted-foreground print:border-black print:text-gray-700">
          Payment method: Cash on delivery
        </p>
      </article>
    </main>
  );
}
