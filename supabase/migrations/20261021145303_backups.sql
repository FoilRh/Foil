CREATE TABLE "backups" (
	"locator" text PRIMARY KEY NOT NULL,
	"blob" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "backups" FROM anon, authenticated;
