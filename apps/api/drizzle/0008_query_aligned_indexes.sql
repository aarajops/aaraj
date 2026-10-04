DROP INDEX "audit"."event_actor_time_idx";--> statement-breakpoint
DROP INDEX "audit"."event_type_time_idx";--> statement-breakpoint
DROP INDEX "catalog"."product_published_updated_idx";--> statement-breakpoint
CREATE INDEX "event_actor_id_time_id_idx" ON "audit"."event" USING btree ("actor_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "event_type_time_id_idx" ON "audit"."event" USING btree ("event_type","occurred_at","id");--> statement-breakpoint
CREATE INDEX "product_size_guide_published_idx" ON "catalog"."product" USING btree ("size_guide_id","is_published");--> statement-breakpoint
CREATE INDEX "product_published_updated_idx" ON "catalog"."product" USING btree ("is_published","updated_at","id");