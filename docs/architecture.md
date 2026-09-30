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

**Email** already works this way: `services/email.js` subscribes to `ticket.issued` and `ticket.resent`,
builds the ticket email with the QR attached, and passes it to a transport. Until `EMAIL_PROVIDER`
is set, the transport sends nothing and records the attempt as `not_configured` in the notification
log. Going live means implementing one transport function; nothing that publishes events changes.
An SMS provider would be another subscriber like it.

**Multiple instances (Vercel):** the bus is in-process, so each API instance only sees its own
events. Everything that must be cross-instance is backed by the database instead. Notifications and
audit entries are written in the request that caused them. The live dashboard stream also polls
`entry_logs` and the stats every `LIVE_POLL_MS` (3 s), so a scan on any instance reaches every
dashboard. Streams end after `LIVE_MAX_SECONDS` (270 s, under Vercel's 300 s limit) and the browser
reconnects.

**Deployment (Vercel):**

```
Browser ──▶ https://<project>.vercel.app
              ├─ /api/*  ──▶ Vercel Function api/index.js ──▶ Express app ──▶ Neon Postgres
              │                                                        └──▶ Vercel Blob (private receipts)
              └─ /*      ──▶ apps/web/dist (static, SPA fallback to index.html)
```

`bootstrap()` runs once per function instance: connect, migrate (under an advisory lock, so parallel
cold starts are safe), register subscribers, and, if `SEED_DEMO=true`, claim the one-time demo seed.

### Domain events

| Event | Published by | Subscribers |
|---|---|---|
| `registration.submitted` / `.resubmitted` | registrations | audit, notification, live |
| `registration.approved` / `.rejected` / `.revision_requested` | registrations | audit, notification*, live |
| `registration.cancelled` | registrations | audit, live |
| `ticket.issued` | registrations (on approve) | audit, notification, email, live |
| `ticket.checked_in` | checkin | audit, notification, live |
| `ticket.scan_rejected` | checkin | audit, live |
| `ticket.cancelled` | registrations (on cancel) | audit, live |
| `comment.created` | routes/registrations | audit, notification |
| `ticket.qr_viewed` / `ticket.qr_exported` | routes/events (organizer backup copies) | audit, live |
| `ticket.resent` | routes/events (organizer Resend) | audit, notification, email, live |
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
| NFR-001 passwords, HTTPS | bcrypt (cost 12). TLS at the host or reverse proxy (see README → Deploying). Helmet sends HSTS; session cookies are `Secure` in production. |
| Brute force | Per-IP rate limits (`middleware/rateLimits.js`), per-account lockout after 5 consecutive failures (15 min, audited as `user.locked`), and equal-time responses for unknown emails. `TRUST_PROXY` is explicit so `X-Forwarded-For` can't be spoofed. |
| Web sessions & CSRF | The JWT lives in an httpOnly, `SameSite=Strict` cookie that scripts can't read. Cookie-authenticated writes need an `X-Requested-With` header that other sites can't send cross-origin. The mobile app uses Bearer tokens in SecureStore. |
| Session revocation | Tokens carry `token_version`; a password change or reset bumps it, which kills every older token. Deactivation takes effect on the next request. |
| NFR-002 / FR-014 RBAC | `requireRole()` on every route, plus ownership checks (an organizer sees only their own events; an attendee sees only their own registrations). The user is reloaded on every request, so deactivation takes effect immediately. |
| Separation of duties (§2.6) | Only coordinators approve. Only gate staff scan. Admins can do neither. Covered by `test/rbac.test.js`. |
| NFR-003 immutable audit | A DB trigger blocks UPDATE, DELETE and TRUNCATE on `audit_logs`. The SHA-256 hash chain makes out-of-band edits detectable via `GET /api/audit/verify`. |
| QR forgery | HMAC-SHA256 signed payload with a per-ticket 128-bit secret. Coordinators and gate staff see only the short code. |
| Organizer QR access | Only the owning organizer can view or print attendee QRs (the backup delivery path). Each view or export is audited with the ticket codes involved. |
| Public event page | `/api/public/events/:id` is the only unauthenticated data endpoint. It returns published or closed events only, with no internal ids or attendee data. |
| Deep-link redirects | After sign-in the app follows `next` only when it's an in-app path (`/…`, not `//…`), so a crafted link can't send users off-app. |
| Uploads | 4 MB limit (Vercel request bodies max out at 4.5 MB), random storage keys, private Vercel Blob in production, and the file's first bytes must match JPG/PNG/WEBP/HEIC/PDF; the detected type is stored. Served only to authorized users, with `nosniff`. Images get a `sandbox` CSP and PDFs download, so an opened proof can't run scripts as our site. |
| Web CSP | Production builds include a Content Security Policy: own scripts only, and requests to the same origin only. |
| Production guards | The API refuses to start in production without `JWT_SECRET`, `QR_SECRET` and an explicit `CORS_ORIGINS`. On Vercel it also refuses to start without a database or a Blob store, so a missing connection can't leave the demo data half-seeded. |
| CSV injection | Report cells that start with `= + - @` are prefixed with `'`. |

Known gaps: rate-limit counters are in memory (use a shared store such as Redis when running several API instances), and uploads are not virus-scanned.