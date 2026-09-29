CREATE SCHEMA "access";
--> statement-breakpoint
CREATE TYPE "access"."assigned_role" AS ENUM('superadmin', 'admin', 'staff', 'moderator');--> statement-breakpoint
CREATE TABLE "access"."role_assignment" (
	"user_id" text NOT NULL,
	"role" "access"."assigned_role" NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" text NOT NULL,
	CONSTRAINT "role_assignment_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
ALTER TABLE "access"."role_assignment" ADD CONSTRAINT "role_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_assignment_role_idx" ON "access"."role_assignment" USING btree ("role");