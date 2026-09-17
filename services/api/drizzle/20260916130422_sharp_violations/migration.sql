CREATE TABLE "data_job" (
	"key" text PRIMARY KEY,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "exchange_rate" (
	"date" date PRIMARY KEY,
	"usd_per_gbp" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "futures_settlement" (
	"product" text,
	"symbol" text,
	"date" date,
	"price_usd" double precision NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"downloaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "futures_settlement_pkey" PRIMARY KEY("product","symbol","date")
);
--> statement-breakpoint
CREATE TABLE "national_price" (
	"date" date PRIMARY KEY,
	"price_pence" double precision NOT NULL,
	"station_count" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "station" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"brand" text NOT NULL,
	"address" text NOT NULL,
	"postcode" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"motorway" boolean NOT NULL,
	"closed" boolean NOT NULL,
	"price_pence" double precision,
	"price_updated_at" timestamp with time zone,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "station_price" (
	"station_id" text,
	"observed_at" timestamp with time zone,
	"price_pence" double precision NOT NULL,
	CONSTRAINT "station_price_pkey" PRIMARY KEY("station_id","observed_at")
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"key" text PRIMARY KEY,
	"synced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracked_station" (
	"user_id" text,
	"station_id" text,
	CONSTRAINT "tracked_station_pkey" PRIMARY KEY("user_id","station_id")
);
--> statement-breakpoint
ALTER TABLE "driver" ADD COLUMN "mileage_mode" text DEFAULT 'average' NOT NULL;--> statement-breakpoint
ALTER TABLE "driver" ADD COLUMN "weekday_miles" jsonb DEFAULT '[20,20,20,20,20,20,20]' NOT NULL;--> statement-breakpoint
ALTER TABLE "driver" ADD COLUMN "onboarding_complete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "futures_date_idx" ON "futures_settlement" ("date");--> statement-breakpoint
CREATE INDEX "station_location_idx" ON "station" ("latitude","longitude");--> statement-breakpoint
ALTER TABLE "station_price" ADD CONSTRAINT "station_price_station_id_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id");--> statement-breakpoint
ALTER TABLE "tracked_station" ADD CONSTRAINT "tracked_station_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tracked_station" ADD CONSTRAINT "tracked_station_station_id_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "station"("id");