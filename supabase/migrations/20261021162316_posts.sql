CREATE TABLE "posts" (
	"post_id" text PRIMARY KEY NOT NULL,
	"season" text NOT NULL,
	"handle" text NOT NULL,
	"handle_pub" text NOT NULL,
	"token_id" text NOT NULL,
	"tin" text NOT NULL,
	"name" text,
	"grade" text,
	"image" text,
	"insured_value" numeric(78, 0),
	"ts" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "posts_season_ts_index" ON "posts" USING btree ("season","ts");--> statement-breakpoint
CREATE INDEX "posts_season_token_id_index" ON "posts" USING btree ("season","token_id");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_season_token_unique" ON "posts" ("season","token_id");--> statement-breakpoint
ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "posts" FROM anon, authenticated;
