# GTM production release checklist

This checklist describes the storefront events emitted by the app and the minimal GTM routing for them. GTM and Stape are managed outside this repository. Import drafts were generated from the supplied web v15 and server v6 exports; they are not published.

## Event contract

- The app emits `page_view`, `view_item`, `view_cart`, `add_to_cart`, `begin_checkout`, and `purchase` as semantic data-layer events.
- `purchase` means the backend created a COD order. It is not collected revenue. `value` is merchandise value, `shipping` is separate, `transaction_id` is the order reference, and the app's stable `event_id` is the order ID.
- Purchase tags use only the exact `purchase` Custom Event trigger and fire once per event. There is no reload condition, exception trigger, consent gate, click rule, URL rule, or manual Event Setup Tool rule on the purchase path. The app already prevents duplicate purchase emission for the same order in a session.
- App navigation is the only source for page views. GA4 `page_location` and `page_title` come from the sanitized `page_view` data-layer event. Keep `send_page_view=false`, disable Pixel pushState page views, and disable GA4 enhanced-measurement page views based on browser history.
- Meta CAPI receives only `page_view`, `view_item`, `add_to_cart`, `begin_checkout`, and `purchase`. Matching browser/server purchase events use the same `Purchase` name and stable order ID.
- Tracking carries no customer contact/form fields and creates no synthetic year-long `external_id` cookie. Keep the server GA4 forwarding exclusions for `user_data.*` as a guard. If customer matching data is deliberately added later, send it only through the Meta CAPI path and hash it server-side.

## Before importing or publishing

1. Rotate the Meta CAPI access token from the supplied server export. The server draft deliberately uses `REPLACE_WITH_ROTATED_META_CAPI_TOKEN`; replace it in the GTM workspace with the new token. Do not publish while the placeholder remains.
2. Import the web and server drafts into their matching containers and review the workspace diff. Keep the existing GA4 destination `G-AARAJBD` consistent in the web and server tags.
3. In the GA4 web stream, disable enhanced-measurement page views based on browser history; this setting is outside the GTM export.
4. Use GTM Preview on the canonical production host and set the Meta Test Events filter to show all event types. Verify one `page_view` per pathname and one GA4 and Meta event per app event. Place a fresh successful COD test order and verify the browser and server Meta Purchase use the same stable order ID. An order already completed before the trigger fix will not replay Purchase on its details page.
5. If the server Purchase needs to appear in Meta Test Events, set that session's current test event code temporarily in the server workspace, verify the event, then remove the code before production publishing.
6. Publish both containers only after the preview checks pass. Confirm GA4 events appear in the intended property and CSP allows the GTM, GA4, Pixel, and Stape requests.
