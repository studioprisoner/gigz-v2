ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_by" uuid;