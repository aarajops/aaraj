CREATE SCHEMA IF NOT EXISTS "audit";
--> statement-breakpoint
CREATE TABLE "audit"."event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"event_type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"request_id" text,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "event_actor_type_check" CHECK ("audit"."event"."actor_type" in ('user', 'service', 'anonymous'))
);
--> statement-breakpoint
CREATE INDEX "event_subject_time_idx" ON "audit"."event" USING btree ("subject_type","subject_id","occurred_at");--> statement-breakpoint
CREATE INDEX "event_actor_time_idx" ON "audit"."event" USING btree ("actor_type","actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "event_type_time_idx" ON "audit"."event" USING btree ("event_type","occurred_at");
