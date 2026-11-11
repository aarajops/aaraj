ALTER TABLE "orders"."order_header" ADD COLUMN IF NOT EXISTS "address_ciphertext" text;--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN IF NOT EXISTS "address_name_prefixes" text[];--> statement-breakpoint
ALTER TABLE "orders"."order_header" ADD COLUMN IF NOT EXISTS "address_phone_prefixes" text[];
