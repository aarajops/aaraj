# Order notifications and COD settlement

## Transactional SMS

`order_header.sms_updates_consent` records the original optional checkout opt-in and is false by default. The checkbox identifies the message purpose and is separate from marketing consent. An order transition trigger writes only an `order_id` and event key to `order_notification_outbox`; the recipient number is never copied into the outbox. The worker decrypts the order address only while sending. Withdrawal from the secure order page appends an immutable revocation fact and suppresses queued rows; the effective consent returned to the customer becomes false. A send already in progress may still complete.

SMS delivery is disabled until the Twilio account, auth token, exactly one sender configuration, and the public status callback URL are set. In production the callback must be HTTPS and must target `/api/v1/orders/notifications/twilio/status`. Each send adds its outbox ID as a signed `notificationId` query parameter, so an early callback can attach the provider message ID before the send worker records its response. Callback signatures are validated with the Twilio Node SDK against the complete URL and provider parameter set. Do not replace this with hand-written signature logic.

The worker disables SDK auto-retry. A provider 4xx response is recorded as a failed send. A timeout, network error, or a worker crash after claiming a message is recorded as unknown and is never automatically retried. Operations must check the provider console and record why a message was sent or confirmed not sent before it can be requeued. The outbox stores provider message IDs and error codes, not customer phone numbers or message bodies. Provider status callbacks advance a known message to accepted, delivered, or failed.

Twilio's current Bangladesh guidance says opt-in is expected, two-way SMS is not supported, and a registered alphanumeric Sender ID is required for Grameenphone, Robi/Axiata, and Teletalk. Customers therefore use the secure order page to withdraw consent. Confirm account coverage, sender registration, account limits, and applicable local requirements before enabling live sends. See [Twilio Bangladesh SMS guidelines](https://www.twilio.com/en-us/guidelines/bd/sms), [Messages resource and status callbacks](https://www.twilio.com/docs/messaging/api/message-resource), and [Twilio webhook security](https://www.twilio.com/docs/usage/webhooks/webhooks-security).

## Courier remittance journal

Importing a courier report and reconciling its rows records the courier's claim. It does not assert that money reached AARAJ's bank account. Finance records the actual bank credit and transaction reference only after checking the bank statement or account. The bank reference is unique so one credited transaction cannot be posted twice.

Bank confirmation writes one immutable, balanced journal with these fixed operational accounts:

| Account key | Posting |
| --- | --- |
| `bank_cash` | Debit the verified bank credit |
| `courier_fee_expense` | Debit courier fees in the reconciled report |
| `cod_settlement_clearing` | Credit the COD amounts in the reconciled report |
| `settlement_variance_suspense` | Use the opposite side for any difference between the actual bank credit and report net |

Postings are integer BDT amounts. The database rejects a journal unless its debits and credits balance, and posted journals and their entries are immutable. A variance remains in suspense pending review; it is not silently booked as income or loss. This is a COD settlement subledger, not a complete general ledger. It does not determine revenue recognition, cost of goods, VAT, or a tax invoice. Configure those through the organization's approved accounting policy and accountant. The printable order receipt is a non-tax delivery receipt.

The source courier report must remain in the finance evidence archive. AARAJ stores normalized lines and a content hash. The settlement confirmation stores the bank reference, actual amount, operator, timestamp, and evidence note; the original bank document is retained in the finance evidence archive under the organization's retention policy.

## Production activation

1. Apply all release migrations through 0068 using the restricted migration role, following the release manifest's maintenance barriers.
2. Re-run `pnpm --filter @aaraj/api run db:grant-runtime` with the production migration workflow so the runtime role receives only the new table grants.
3. Keep SMS credentials empty until the consent copy, sender registration, callback URL, and provider test account are approved. Then provision secrets through the production secret store.
4. Verify one consented test message, its provider callback, and the stop-updates action before enabling customer sends.
5. Verify bank reference, actual credited amount, suspense variance, and journal export against finance's approved account mapping before operational posting.
