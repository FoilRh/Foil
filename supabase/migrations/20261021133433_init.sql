CREATE TABLE "cards" (
	"token_id" text PRIMARY KEY NOT NULL,
	"tin" text,
	"name" text,
	"grade" text,
	"image" text,
	"insured_value" numeric(78, 0),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cursors" (
	"source" text PRIMARY KEY NOT NULL,
	"block" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"machine_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"price" numeric(78, 0) NOT NULL,
	"ev" numeric(78, 0),
	"ev_low" numeric(78, 0),
	"buyback_bps" integer,
	"partner_fee_bps" integer DEFAULT 0 NOT NULL,
	"adopted" boolean DEFAULT false NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"odds" text,
	"quoted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_reveals" (
	"round_id" bigint NOT NULL,
	"tin" text NOT NULL,
	"salt" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_reveals_round_id_tin_pk" PRIMARY KEY("round_id","tin")
);
--> statement-breakpoint
CREATE TABLE "pool_events" (
	"tx" text NOT NULL,
	"log_index" integer NOT NULL,
	"block" bigint NOT NULL,
	"kind" text NOT NULL,
	"size" numeric(78, 0),
	"ts" timestamp with time zone NOT NULL,
	CONSTRAINT "pool_events_tx_log_index_pk" PRIMARY KEY("tx","log_index")
);
--> statement-breakpoint
CREATE TABLE "rips_agg" (
	"day" text NOT NULL,
	"machine_id" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"gross_usd" numeric(78, 0) DEFAULT '0' NOT NULL,
	"sold_back_usd" numeric(78, 0) DEFAULT '0' NOT NULL,
	CONSTRAINT "rips_agg_day_machine_id_pk" PRIMARY KEY("day","machine_id")
);
--> statement-breakpoint
CREATE TABLE "round_requests" (
	"round_id" bigint NOT NULL,
	"req_idx" integer NOT NULL,
	"state" text DEFAULT 'Pending' NOT NULL,
	CONSTRAINT "round_requests_round_id_req_idx_pk" PRIMARY KEY("round_id","req_idx")
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"round_id" bigint PRIMARY KEY NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"n_requests" integer DEFAULT 0 NOT NULL,
	"n_tins" integer,
	"operator" text,
	"state" text DEFAULT 'Open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status" (
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"component" text NOT NULL,
	"ok" boolean NOT NULL,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "tins_pub" (
	"tin" text PRIMARY KEY NOT NULL,
	"round_id" bigint NOT NULL,
	"funded" numeric(78, 0) NOT NULL,
	"sent_back" numeric(78, 0) DEFAULT '0' NOT NULL,
	"send_backs" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pool_events_kind_ts_index" ON "pool_events" USING btree ("kind","ts");--> statement-breakpoint
CREATE INDEX "status_component_ts_index" ON "status" USING btree ("component","ts");