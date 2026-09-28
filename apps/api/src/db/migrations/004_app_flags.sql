-- One-time jobs across all API instances (e.g. seeding demo data on first boot). Inserting a flag
-- with ON CONFLICT DO NOTHING lets exactly one instance claim the job.
CREATE TABLE app_flags (
  name       text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
