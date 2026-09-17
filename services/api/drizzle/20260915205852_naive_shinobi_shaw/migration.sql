CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver" (
	"user_id" text PRIMARY KEY,
	"vehicle_name" text NOT NULL,
	"tank_capacity_litres" double precision NOT NULL,
	"current_litres" double precision NOT NULL,
	"mpg" double precision NOT NULL,
	"daily_miles" double precision NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"fuel_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_fuel_bounds" CHECK ("current_litres" >= 0 AND "current_litres" <= "tank_capacity_litres"),
	CONSTRAINT "driver_consumption_bounds" CHECK ("mpg" >= 10 AND "daily_miles" >= 0 AND "tank_capacity_litres" >= 15)
);
--> statement-breakpoint
CREATE TABLE "market_observation" (
	"id" text PRIMARY KEY,
	"source" text NOT NULL,
	"date" date NOT NULL,
	"wholesale_pence" double precision NOT NULL,
	"retail_pence" double precision NOT NULL,
	"usd_per_gbp" double precision NOT NULL,
	"disruption" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY,
	"key" text NOT NULL UNIQUE,
	"count" integer NOT NULL,
	"last_request" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"token" text NOT NULL UNIQUE,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "sms_message" (
	"id" text PRIMARY KEY,
	"user_id" text,
	"phone_number" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"dedupe_key" text NOT NULL UNIQUE,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"phone_number" text UNIQUE,
	"phone_number_verified" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_source_date_idx" ON "market_observation" ("source","date");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "sms_user_created_idx" ON "sms_message" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "driver" ADD CONSTRAINT "driver_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sms_message" ADD CONSTRAINT "sms_message_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;