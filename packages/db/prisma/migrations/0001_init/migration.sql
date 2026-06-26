CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY,
  "email" text UNIQUE,
  "name" text,
  "image" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "accounts" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "provider_account_id" text NOT NULL,
  "access_token" text,
  "refresh_token" text,
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "accounts_provider_provider_account_id_key" UNIQUE ("provider", "provider_account_id")
);

CREATE INDEX IF NOT EXISTS "accounts_user_id_idx" ON "accounts" ("user_id");

CREATE TABLE IF NOT EXISTS "telemetry_installations" (
  "install_id" text PRIMARY KEY,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "channel" text NOT NULL,
  "app_version" text NOT NULL,
  "os_family" text NOT NULL,
  "arch" text NOT NULL,
  "setup_install_mode" text NOT NULL,
  "database_mode" text NOT NULL,
  "enabled_services" jsonb NOT NULL,
  "media_servers" jsonb NOT NULL,
  "backups" jsonb NOT NULL,
  "counts" jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "telemetry_events" (
  "id" text PRIMARY KEY,
  "install_id" text NOT NULL REFERENCES "telemetry_installations"("install_id") ON DELETE CASCADE,
  "schema_version" integer NOT NULL,
  "event_name" text NOT NULL,
  "generated_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "payload" jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "telemetry_events_install_id_idx" ON "telemetry_events" ("install_id");
CREATE INDEX IF NOT EXISTS "telemetry_events_received_at_idx" ON "telemetry_events" ("received_at");
