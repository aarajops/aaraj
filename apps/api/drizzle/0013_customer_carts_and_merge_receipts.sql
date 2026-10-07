CREATE SCHEMA "cart";
--> statement-breakpoint
CREATE TABLE "cart"."merge_receipt" (
	"guest_cart_hash" text NOT NULL,
	"guest_revision" bigint NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merge_receipt_guest_cart_hash_guest_revision_pk" PRIMARY KEY("guest_cart_hash","guest_revision"),
	CONSTRAINT "cart_merge_receipt_hash_check" CHECK ("cart"."merge_receipt"."guest_cart_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "cart_merge_receipt_revision_check" CHECK ("cart"."merge_receipt"."guest_revision" between 0 and 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "cart"."customer_cart" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text NOT NULL,
	"currency" text DEFAULT 'BDT' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_cart_currency_check" CHECK ("cart"."customer_cart"."currency" = 'BDT'),
	CONSTRAINT "customer_cart_schema_version_check" CHECK ("cart"."customer_cart"."schema_version" = 1),
	CONSTRAINT "customer_cart_revision_check" CHECK ("cart"."customer_cart"."revision" between 0 and 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "cart"."customer_cart_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"product_snapshot" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_cart_line_quantity_check" CHECK ("cart"."customer_cart_line"."quantity" between 1 and 10),
	CONSTRAINT "customer_cart_line_snapshot_object_check" CHECK (jsonb_typeof("cart"."customer_cart_line"."product_snapshot") = 'object')
);
--> statement-breakpoint
ALTER TABLE "cart"."customer_cart" ADD CONSTRAINT "customer_cart_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "identity"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart"."customer_cart_line" ADD CONSTRAINT "customer_cart_line_cart_id_customer_cart_id_fk" FOREIGN KEY ("cart_id") REFERENCES "cart"."customer_cart"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_cart_customer_uidx" ON "cart"."customer_cart" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_cart_line_variant_uidx" ON "cart"."customer_cart_line" USING btree ("cart_id","variant_id");