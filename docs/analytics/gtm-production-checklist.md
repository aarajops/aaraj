# GTM production release checklist

This checklist is for the published web container `GTM-N28C5K72`. The storefront code can be reviewed in this repository; the published container and Stape server container are managed outside it.

## Required published-container edits

1. **Remove the legacy checkout tag.** Delete the click trigger that checks for `gtm.elementId = place_order` and the Custom HTML tag that reads `#billing_first_name`, `#billing_last_name`, and related Shopify fields into `localStorage`. The current checkout does not use those fields, and that tag has no tracking purpose.
2. **Make app navigation the single page-view source.** The app pushes one `page_view` custom event per Next.js pathname, with a sanitized `page_location` and `page_title`; filter-only query changes do not create extra page views. Fire the GA4 page-view tag on this custom event. Remove its current `gtm.js` page-view trigger, keep `send_page_view=false`, and disable GA4 enhanced-measurement page views based on browser history. For Meta, set the Pixel base tag's `disablePushState=true` and fire one PageView event on the same `page_view` custom event. Do not add a second GTM History Change trigger.
3. **Use one firing per event.** GA4 ecommerce tags and Meta event tags should use GTM's **Once per event** firing option. Base Google/Meta initialization remains **Once per page**. Use exact Custom Event triggers for `view_item`, `view_cart`, `add_to_cart`, `begin_checkout`, and `purchase`. No Meta Event Setup Tool button or URL rules are needed; the app emits events for GTM to handle.
4. **Keep `view_cart` out of Meta standard events.** Fire the GA4 `view_cart` event on `view_cart`. The app does not provide a Meta `ViewCart` standard event. If the published container has a custom Meta `view_cart` tag, remove it unless the business specifically needs that custom event.
5. **Map full ecommerce fields.** For GA4, map `currency`, `value`, `shipping`, `transaction_id`, and the complete `items` array from `ecommerce`. Preserve `item_id`, `item_name`, `item_variant`, `price`, and `quantity`. Remove `item_category` mapping unless the app begins sending it; any optional field macro must safely handle an absent value. For Meta event tags, map `event_id` to the Pixel `eventID` option and preserve contents, value, and currency.
6. **Keep purchase semantics consistent.** `purchase` means the backend successfully created an order. For COD, that is a submitted but not yet collected order; `value` is merchandise value, `shipping` is separate, `transaction_id` is the order reference, and Meta `event_id` is the stable order ID. Treat these conversions as submitted orders, not collected revenue. GA4 and Meta browser Purchase are sent through GTM. Do not fire purchase on order-detail visits, retries, or status changes.
7. **Review Meta CAPI before enabling more events.** The current browser container has Meta CAPI helper tags and the Stape server container is outside this repository. Confirm browser/server events share the same event name and stable `event_id` before enabling ecommerce CAPI. Until that is confirmed, keep browser purchase as the only purchase sender. The storefront CSP now permits vendor subdomains used by Google tags, Meta/Pixel/CAPI, Stape, and the helper CDNs.
8. **Limit persistent identifiers and keep form data out of tracking.** The container currently creates an `external_id` cookie with a 365-day lifetime. Remove it if it has no clear purpose; otherwise set a documented, purpose-limited lifetime. Never send customer name, phone, address, email, or form values through the data layer.

## Preview and publish checks

Use GTM Preview on the canonical production-equivalent host and verify:

- A direct page load and each client-side pathname change produce exactly one GA4 and Meta `PageView` event. Filter-only query changes produce none.
- Repeated add-to-cart actions produce one GA4 and one Meta event per successful cart mutation. `view_cart` is GA4-only. `begin_checkout` carries the expected item, currency, value, and shipping fields.
- A COD order emits one GA4 purchase and one Meta browser Purchase through GTM after the API confirms creation; refreshing or revisiting the order emits none. Keep server-side Meta Purchase disabled until its event name and `event_id` are confirmed to deduplicate against the browser event.
- CSP has no blocked GTM, GA4, Meta Pixel, Meta CAPI helper, or Stape requests. Check GA4 DebugView and Meta Test Events before publishing.

Publish the reviewed container version only after these checks pass. The server-side Stape container must be reviewed separately because it is not part of this repository.
