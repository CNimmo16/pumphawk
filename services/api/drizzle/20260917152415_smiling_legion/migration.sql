CREATE TABLE "forecast_run" (
	"frequency" text,
	"origin" timestamp with time zone,
	"model_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inputs" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	CONSTRAINT "forecast_run_pkey" PRIMARY KEY("frequency","origin","model_version")
);
--> statement-breakpoint
CREATE TABLE "model_fx_rate" (
	"date" date,
	"available_at" timestamp with time zone,
	"usd_per_gbp" double precision NOT NULL,
	CONSTRAINT "model_fx_rate_pkey" PRIMARY KEY("date","available_at")
);
--> statement-breakpoint
CREATE TABLE "model_price" (
	"frequency" text,
	"date" date,
	"available_at" timestamp with time zone NOT NULL,
	"price_pence" double precision NOT NULL,
	"station_count" integer,
	"source" text NOT NULL,
	"open_station_price_pence" double precision,
	CONSTRAINT "model_price_pkey" PRIMARY KEY("frequency","date")
);
--> statement-breakpoint
CREATE TABLE "model_pump_event" (
	"station_id" text,
	"source_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"available_at" timestamp with time zone NOT NULL,
	"price_pence" double precision,
	"source" text NOT NULL,
	CONSTRAINT "model_pump_event_pkey" PRIMARY KEY("station_id","source_at","received_at")
);
--> statement-breakpoint
CREATE TABLE "model_settlement_event" (
	"product" text,
	"symbol" text,
	"date" date,
	"published_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"price_usd" double precision NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "model_settlement_event_pkey" PRIMARY KEY("product","symbol","date","published_at")
);
--> statement-breakpoint
CREATE INDEX "model_pump_available_idx" ON "model_pump_event" ("available_at");--> statement-breakpoint
CREATE INDEX "model_settlement_date_idx" ON "model_settlement_event" ("date");