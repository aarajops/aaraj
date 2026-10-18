ALTER TABLE "storefront"."configuration" ADD COLUMN "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD COLUMN "footer_link_groups" jsonb DEFAULT '{"about":[],"policies":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD COLUMN "footer_category_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "storefront"."configuration"
SET "footer_link_groups" = jsonb_build_object(
	'about', "footer_links",
	'policies', '[]'::jsonb
);--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD CONSTRAINT "configuration_footer_link_groups_check" CHECK (case when jsonb_typeof("storefront"."configuration"."footer_link_groups") = 'object' then jsonb_typeof("storefront"."configuration"."footer_link_groups"->'about') = 'array' and jsonb_typeof("storefront"."configuration"."footer_link_groups"->'policies') = 'array' else false end);--> statement-breakpoint
ALTER TABLE "storefront"."configuration" ADD CONSTRAINT "configuration_footer_category_ids_check" CHECK (jsonb_typeof("storefront"."configuration"."footer_category_ids") = 'array');
