-- Where attendees send payment for paid tickets (e.g. GCash number, bank account and account name).
-- Required before an event with paid tickets can be published.
ALTER TABLE events ADD COLUMN payment_instructions text NOT NULL DEFAULT '';
