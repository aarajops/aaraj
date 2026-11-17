ALTER TABLE "catalog"."category" ADD COLUMN "edit_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog"."size_guide" ADD COLUMN "edit_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog"."category" ADD CONSTRAINT "category_edit_revision_check" CHECK ("catalog"."category"."edit_revision" > 0);--> statement-breakpoint
ALTER TABLE "catalog"."size_guide" ADD CONSTRAINT "size_guide_edit_revision_check" CHECK ("catalog"."size_guide"."edit_revision" > 0);
