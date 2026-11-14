# Commerce dashboard metrics

The admin overview uses Aaraj's order database and audit log. The selected
period is a Bangladesh calendar period (Asia/Dhaka), including today and the
previous 6, 29, or 89 calendar days. Current operations counts are live and do
not use the selected period.

The web overview reads `GET /api/v1/dashboard/overview?range=30d`. The endpoint
is owned by a standalone API dashboard module; it is read-only and checks the
`orders.manage` permission. Range is optional and defaults to `30d`; supported
values are `7d`, `30d`, and `90d`. Responses are not cached.

| Measure                         | Rule                                                                                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orders placed                   | Count orders by `order_header.created_at`, including later cancellations.                                                                                                                                |
| Current COD order value         | Sum each non-cancelled order's current `cod_amount_due_bdt` for orders created in the period. This is requested order value, not earned or received revenue.                                             |
| Net COD reconciled              | Sum the change recorded by each `commerce.cod_collection_reconciled` audit event in the period: new collected amount minus the previous collected amount. Corrections can make a day or period negative. |
| Need staff action               | Current orders in `pending`, `no_answer`, or `on_hold`.                                                                                                                                                  |
| Awaiting dispatch / in delivery | Current orders with fulfillment status `awaiting_dispatch` / `dispatched`.                                                                                                                               |
| Delivery outcome orders         | Current orders with fulfillment status `partially_delivered`, `delivery_failed`, or `returned`.                                                                                                          |
| COD discrepancies               | Current orders whose collection status is `discrepancy`.                                                                                                                                                 |
| Most ordered products           | Current line quantities on non-cancelled orders created in the period, grouped by saved product, color, and size.                                                                                        |

Order value and product quantities use the order's current saved state, so later
staff edits are reflected in the original order period. COD reconciliation is
dated by the audit event, so a later correction appears when staff records it.
The overview is read-only and restricted to `orders.manage`.

The current model does not record storefront sessions, marketing spend, product
cost, refund values, or courier remittances. Do not label the available figures
as conversion rate, acquisition cost, profit, net sales, or settled cash. Add
those measures only when their source data and business rules are implemented.

Period queries use the order creation-date index and audit event type/time
index. The current live operations counters use one aggregate scan over the
current order table. Keep this as a live read model while query volume is small;
add a summary table only if production query measurements show that this view
is slow.
