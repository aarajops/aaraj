ALTER TABLE "catalog"."category" DROP CONSTRAINT "category_sort_order_check";--> statement-breakpoint
DROP INDEX "catalog"."category_parent_order_idx";--> statement-breakpoint
CREATE INDEX "category_parent_idx" ON "catalog"."category" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "catalog"."category" DROP COLUMN "sort_order";