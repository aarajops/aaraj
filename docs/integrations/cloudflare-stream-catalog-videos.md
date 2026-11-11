# Cloudflare Stream for catalogue videos

The catalogue stores provider IDs and operational state in PostgreSQL. Cloudflare Stream stores and encodes the video bytes. Customer browsers never receive the Stream API token; staff receive only a one-time, expiring upload URL after the API authorizes and records an upload command.

## Configure the provider

Set these variables in the API runtime environment:

- `CLOUDFLARE_STREAM_ACCOUNT_ID`: the Cloudflare account ID.
- `CLOUDFLARE_STREAM_API_TOKEN`: an account-scoped token with Stream read and edit permissions, kept only on the API host.
- `CLOUDFLARE_STREAM_WEBHOOK_SECRET`: the signing secret returned when registering the Stream webhook.
- `CLOUDFLARE_STREAM_UPLOAD_KEYRING`: an active-key JSON keyring used only to encrypt pending one-time upload URLs at rest. Generate each value from 32 random bytes, encoded as canonical base64url. Keep an old key in the keyring while any unexpired upload URL encrypted with it may still be retried.

Register this publicly reachable HTTPS callback in the Cloudflare Stream account:

```text
https://<API_HOST>/api/v1/catalog/videos/webhook
```

Stream currently supports one webhook subscription per account. If that account already sends events elsewhere, route those events through a shared receiver before changing the subscription. The API verifies `Webhook-Signature` over the original raw request bytes with HMAC-SHA256, rejects timestamps more than five minutes from local time, and deduplicates signed payloads in the webhook inbox.

## Upload and playback behavior

The API provisions a TUS upload with a six-hour expiry, a 180-second maximum duration, and private playback enabled. Staff upload directly to Stream using the browser's resumable TUS client. The upload URL is AES-256-GCM encrypted with video-ID associated data, never included in the management list, and returned only from the authorized, no-store provisioning response. Replaying the same command returns the same URL while it remains valid.

Only a signed ready webhook or an authorized **Sync** operation moves a video into the public catalogue. Playback tokens expire after one hour and are cached in process for at most 50 minutes. The storefront requests tokens only for published products and loads the Stream iframe after the customer chooses to play a video. Variant color, staff title, ordering, and WebVTT captions remain in the catalogue system of record.

Deletion hides the asset from customers immediately, then deletes it at Stream. A provider failure leaves the row in `deleting` state so staff can retry. Deleting a product video is a permanent provider action and is recorded with the staff-provided reason in the audit log.

## Provider references

- [Direct creator uploads](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/) describes TUS direct uploads, upload expiry, maximum duration, and direct upload URLs.
- [Resumable uploads](https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/) documents TUS chunk size and `stream-media-id` behavior.
- [Stream webhooks](https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/) documents raw-body HMAC-SHA256 verification.
- [Secure Stream playback](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/) documents signed playback tokens and their maximum lifetime.
- [Adding captions](https://developers.cloudflare.com/stream/edit-videos/adding-captions/) documents BCP 47 language tags and WebVTT caption management.
