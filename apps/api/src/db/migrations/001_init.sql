-- EntryLink initial schema
-- Status columns use text + CHECK (instead of enums) so new states can be added with a simple migration.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  full_name     text NOT NULL,
  phone         text,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'organizer', 'coordinator', 'gate_staff', 'attendee')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  venue        text NOT NULL,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  capacity     integer NOT NULL CHECK (capacity > 0),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  organizer_id uuid NOT NULL REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX events_organizer_idx ON events (organizer_id);

CREATE TABLE ticket_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  -- NULL = no per-type limit (still bounded by event capacity)
  quantity    integer CHECK (quantity IS NULL OR quantity > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name)
);

CREATE TABLE registrations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES events (id),
  ticket_type_id      uuid NOT NULL REFERENCES ticket_types (id),
  attendee_id         uuid NOT NULL REFERENCES users (id),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'revision_requested', 'approved', 'rejected', 'cancelled')),
  amount_cents        integer NOT NULL CHECK (amount_cents >= 0),
  payment_reference   text,
  proof_path          text,
  proof_mime          text,
  proof_original_name text,
  review_note         text,
  reviewed_by         uuid REFERENCES users (id),
  reviewed_at         timestamptz,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- One live registration per attendee per event; rejected/cancelled ones don't block re-registering.
CREATE UNIQUE INDEX registrations_one_active
  ON registrations (event_id, attendee_id) WHERE status NOT IN ('rejected', 'cancelled');
CREATE INDEX registrations_event_status_idx ON registrations (event_id, status);

-- Version tracking: every status transition of a registration.
CREATE TABLE registration_history (
  id              bigserial PRIMARY KEY,
  registration_id uuid NOT NULL REFERENCES registrations (id),
  version         integer NOT NULL,
  from_status     text,
  to_status       text NOT NULL,
  actor_id        uuid REFERENCES users (id),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX registration_history_reg_idx ON registration_history (registration_id);

CREATE TABLE tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL UNIQUE REFERENCES registrations (id),
  event_id        uuid NOT NULL REFERENCES events (id),
  attendee_id     uuid NOT NULL REFERENCES users (id),
  -- secret embedded in the QR payload; never shown to staff
  secret          text NOT NULL UNIQUE,
  -- human-readable code for manual lookup at the gate, e.g. "7K4Q-9XMZ"
  short_code      text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'checked_in', 'cancelled', 'expired')),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  checked_in_at   timestamptz,
  checked_in_by   uuid REFERENCES users (id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_event_status_idx ON tickets (event_id, status);

-- Every scan attempt at the gate, accepted or not.
CREATE TABLE entry_logs (
  id         bigserial PRIMARY KEY,
  event_id   uuid NOT NULL REFERENCES events (id),
  ticket_id  uuid REFERENCES tickets (id),
  scanned_by uuid NOT NULL REFERENCES users (id),
  method     text NOT NULL CHECK (method IN ('scan', 'manual')),
  result     text NOT NULL CHECK (result IN ('accepted', 'duplicate', 'invalid', 'wrong_event', 'not_active', 'expired')),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entry_logs_event_idx ON entry_logs (event_id, created_at DESC);

CREATE TABLE comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES registrations (id),
  author_id       uuid NOT NULL REFERENCES users (id),
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_registration_idx ON comments (registration_id, created_at);

-- Notification log. Delivery is simulated (in-app); `channel` leaves room for email/sms subscribers later.
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id),
  type       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  channel    text NOT NULL DEFAULT 'in_app',
  data       jsonb NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- Append-only, hash-chained audit trail. Each row's hash covers its content plus the previous row's hash,
-- so editing or deleting any historical row breaks verification (GET /api/audit/verify).
CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  actor_id    uuid REFERENCES users (id),
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  data        jsonb NOT NULL DEFAULT '{}',
  prev_hash   text NOT NULL,
  hash        text NOT NULL UNIQUE
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);

CREATE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();
