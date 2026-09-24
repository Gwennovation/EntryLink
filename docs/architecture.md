# EntryLink architecture

## System context

```
 ┌──────────────────────┐        ┌───────────────────────────────┐
 │  Mobile app (Expo)   │        │  Web dashboard (React/Vite)   │
 │  Attendee            │        │  Admin · Organizer ·          │
 │  register, upload,   │        │  Coordinator · Gate Staff     │
 │  ticket wallet       │        │                               │
 └─────────┬────────────┘        └──────────────┬────────────────┘
           │ HTTPS + JWT (REST, multipart)       │ HTTPS + JWT (REST) · SSE live feed
           └──────────────────┬──────────────────┘
                     ┌────────▼─────────┐
                     │ Express REST API │── local disk / object storage (proof files)
                     └────────┬─────────┘
                     ┌────────▼─────────┐
                     │   PostgreSQL     │
                     └──────────────────┘
```

## Code map (`apps/api/src`)

| Path | Responsibility |
|---|---|
| `routes/` | HTTP layer only: auth, validation (zod), role checks, response shape |
| `services/registrations.js` | Registration state machine, capacity checks, review decisions |
| `services/tickets.js` | **Ticketing Service**: issues tickets and renders QR codes |
| `services/checkin.js` | Gate validation pipeline (scan + manual override) |
| `services/notifications.js` | **Notification Service** (bus subscriber) |
| `services/audit.js` | **Audit Logging Service** (bus subscriber) with a hash chain |
| `services/live.js` | Live dashboard SSE fan-out (bus subscriber) |
| `services/stats.js` | Dashboard counts, end-of-event report, CSV export |
| `lib/bus.js` | In-process domain event bus |
| `lib/qr.js` | Signed QR payloads, short codes |
| `db/` | Driver abstraction (pg / PGlite), SQL migrations, seed |

## Integration component (spec §2.4)

The core services never call notification, audit or dashboard code directly. They commit their
transaction, then **publish a domain event**. Each subscriber reacts on its own:

```
Coordinator approves ──▶ registrations.review()  [tx: status → approved, history row, INSERT ticket]
                          │ commit
                          ├─ publish registration.approved ─┬─▶ Audit: append hash-chained entry
                          │                                 └─▶ Live: push stats to dashboards
                          └─ publish ticket.issued ─────────┬─▶ Notification: "Your ticket is ready"
                                                            ├─▶ Audit
                                                            └─▶ Live

Gate scans QR ──▶ checkin.scanTicket()
                   1. verify HMAC signature (forged codes rejected with no DB lookup)
                   2. load ticket, check event match / cancelled / expired
                   3. UPDATE tickets SET status='checked_in' WHERE id=$1 AND status='issued'
                      (atomic: a second gate scanning the same code gets 0 rows → "duplicate")
                   4. INSERT entry_logs (every attempt, accepted or not)
                   │ commit
                   └─ publish ticket.checked_in | ticket.scan_rejected ──▶ Audit, Live, Notification
```

**Adding a real SMS/email provider** means adding one file that subscribes to `ticket.issued`
(etc.) and registering it in `services/subscribers.js`. No other code changes.

**Scaling note:** the bus is in-process. If the API runs as several instances, swap `lib/bus.js`
for Redis pub/sub or a queue, so SSE clients on every instance get updates. The publish and
subscribe interface stays the same.

### Domain events

| Event | Published by | Subscribers |
|---|---|---|
| `registration.submitted` / `.resubmitted` | registrations | audit, notification, live |
| `registration.approved` / `.rejected` / `.revision_requested` | registrations | audit, notification*, live |
| `registration.cancelled` | registrations | audit, live |
| `ticket.issued` | registrations (on approve) | audit, notification, live |
| `ticket.checked_in` | checkin | audit, notification, live |
| `ticket.scan_rejected` | checkin | audit, live |
| `ticket.cancelled` | registrations (on cancel) | audit, live |
| `comment.created` | routes/registrations | audit, notification |
| `ticket.qr_viewed` / `ticket.qr_exported` | routes/events (organizer backup copies) | audit, live |
| `event.*`, `ticket_type.*`, `user.*`, `report.generated` | routes | audit |

\* `approved` itself sends no notification; `ticket.issued` does.

## Data model

```
users ─┬─< events (organizer_id) ─< ticket_types
       │            │                    │
       └─< registrations >───────────────┘
              │  ├─< registration_history   (every status transition, with version)
              │  ├─< comments
              │  └── tickets (1:1) ─< entry_logs (every scan attempt)
       notifications (user_id)
       audit_logs (append-only; prev_hash → hash chain)
```

Registration lifecycle: `pending → approved | rejected | revision_requested`,
`revision_requested → pending` (resubmit, version + 1), and `pending | revision_requested | approved → cancelled`.
Ticket lifecycle: `issued → checked_in | cancelled | expired`.

## Security controls

| Requirement | Implementation |
|---|---|
| NFR-001 passwords, HTTPS | bcrypt (cost 12). Run TLS at the reverse proxy or host (Render, Railway, Nginx). The API sets `trust proxy`. |
| NFR-002 / FR-014 RBAC | `requireRole()` on every route, plus ownership checks (an organizer sees only their own events; an attendee sees only their own registrations). The user is reloaded on every request, so deactivation takes effect immediately. |
| Separation of duties (§2.6) | Only coordinators approve. Only gate staff scan. Admins can do neither. Covered by `test/rbac.test.js`. |
| NFR-003 immutable audit | A DB trigger blocks UPDATE, DELETE and TRUNCATE on `audit_logs`. The SHA-256 hash chain makes out-of-band edits detectable via `GET /api/audit/verify`. |
| QR forgery | HMAC-SHA256 signed payload with a per-ticket 128-bit secret. Coordinators and gate staff see only the short code. |
| Organizer QR access | Only the owning organizer can view or print attendee QRs (the backup delivery path). Each view or export is audited with the ticket codes involved. |
| Uploads | Allow-listed MIME types, 5 MB limit, random server-side filenames, served only to authorized users. |
| CSV injection | Report cells that start with `= + - @` are prefixed with `'`. |

Known gaps (fine for a prototype, fix before production): no login rate limiting, the SSE token
travels in the query string (use a short-lived stream token), and uploads are not virus-scanned.
