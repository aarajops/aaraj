CREATE INDEX "user_created_at_id_idx" ON "identity"."user" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "user_name_lower_prefix_idx" ON "identity"."user" USING btree (lower("name") text_pattern_ops);--> statement-breakpoint
CREATE INDEX "user_email_lower_prefix_idx" ON "identity"."user" USING btree (lower("email") text_pattern_ops);