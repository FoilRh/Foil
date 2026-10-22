CREATE TABLE "handles" (
	"season" text NOT NULL,
	"handle" text NOT NULL,
	"handle_pub" text NOT NULL,
	CONSTRAINT "handles_season_handle_pk" PRIMARY KEY("season","handle")
);
--> statement-breakpoint
ALTER TABLE "handles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "handles" FROM anon, authenticated;
