# EntryLink REST API contract

Base URL: `/api`. JSON in and out, except uploads (multipart) and the CSV report.
Authenticate with `Authorization: Bearer <jwt>` (from `/auth/login` or `/auth/signup`).

**Errors** always look like this:

```json
{ "error": { "code": "bad_request", "message": "note: is required — tell the attendee why", "details": [{ "field": "note", "message": "…" }] } }
```

| Status | `code` | Meaning |
|---|---|---|
| 400 | `bad_request` | Validation failed. `message` names the field. |
| 401 | `unauthorized` | Missing or expired token, or inactive account |
| 403 | `forbidden` | Your role can't do this |
| 404 | `not_found` | Doesn't exist, or you're not allowed to know it exists |
| 409 | `conflict` | Invalid state transition, sold out, duplicate |

Roles: `admin`, `organizer`, `coordinator`, `gate_staff`, `attendee`.

## Auth

| Method | Path | Role | Body / notes |
|---|---|---|---|
| POST | `/auth/signup` | public | `{ email, password (≥8), full_name, phone? }` → `{ token, user }`. Always creates an attendee. |
| POST | `/auth/login` | public | `{ email, password }` → `{ token, user }` |
| GET | `/auth/me` | any | → `{ user }` |
| POST | `/auth/change-password` | any | `{ current_password, new_password }` → 204 |

## Users (FR-011)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/users?role=&q=` | admin | |
| POST | `/users` | admin | `{ email, full_name, role, password, phone? }` |
| PATCH | `/users/:id` | admin | `{ full_name?, phone?, role?, is_active? }`. You can't change your own role or deactivate yourself. |
| POST | `/users/:id/reset-password` | admin | `{ password }` → 204 |

## Events & ticket types (FR-009)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/events` | any | Attendees: published upcoming events. Organizers: their own. Others: all non-draft (admins also see drafts). Each event includes `ticket_types[]` (with `sold`) and `approved_count`. |
| GET | `/events/:id` | any | Drafts are visible only to the owner and admins |
| POST | `/events` | organizer | `{ title, description?, venue, starts_at, ends_at, capacity, ticket_types: [{ name, price_cents, quantity?, description? }] }`. Created as `draft`. |
| PATCH | `/events/:id` | owner | Any event field. Capacity can't go below the approved count. |
| POST | `/events/:id/publish` | owner | draft → published |
| POST | `/events/:id/close` | owner | Stops registration and entry; unused tickets → `expired` |
| POST | `/events/:id/ticket-types` | owner | `{ name, price_cents, quantity?, description? }` |
| DELETE | `/events/:id/ticket-types/:typeId` | owner | Only if the type has no registrations |

## Dashboards & reports (FR-008, FR-013)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/events/:id/stats` | owner organizer, coordinator, gate staff | `{ stats, recent_entries }` |
| GET | `/events/:id/live?access_token=` | owner organizer, coordinator | **Server-Sent Events.** Emits `stats` (same shape as above) on connect and after every change, and `activity` `{ name, occurred_at, data }` for each domain event. |
| GET | `/events/:id/report[?format=csv]` | owner organizer, coordinator | `{ report: { event, summary, by_ticket_type, checkins_by_hour, attendees } }`, or a CSV download |

`stats` shape:

```json
{ "capacity": 300, "registrations": { "total": 3, "pending": 1, "revision_requested": 0, "approved": 2, "rejected": 0, "cancelled": 0 },
  "tickets_issued": 2, "checked_in": 1, "rejected_scans": 0, "revenue_cents": 20000, "generated_at": "…" }
```

## Registrations (FR-001–003, FR-012)

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/registrations` | attendee | **multipart**: `event_id`, `ticket_type_id`, `payment_reference`, `proof` (file). Proof and reference are required for paid tickets. Accepts JPG, PNG, WEBP, HEIC or PDF up to 5 MB. |
| GET | `/registrations/mine` | attendee | |
| PUT | `/registrations/:id/resubmit` | attendee (owner) | **multipart**: `payment_reference?`, `proof?`. Only from `revision_requested`. Increments `version`. |
| POST | `/registrations/:id/cancel` | attendee (owner) | From pending, revision_requested, or approved-but-unused |
| GET | `/registrations?event_id=&status=&q=` | coordinator, organizer (own events) | Review queue, oldest first |
| GET | `/registrations/:id` | owner, coordinator, event organizer | `{ registration, history[], ticket }` |
| GET | `/registrations/:id/proof` | same | Streams the uploaded file |
| POST | `/registrations/:id/approve` | coordinator | `{ note? }` → `{ registration, ticket }`. **Issues the QR ticket.** |
| POST | `/registrations/:id/reject` | coordinator | `{ note }` (required) |
| POST | `/registrations/:id/request-revision` | coordinator | `{ note }` (required) |
| GET | `/registrations/:id/comments` | owner, coordinator, event organizer | |
| POST | `/registrations/:id/comments` | owner attendee, coordinator | `{ body }` |

## Tickets

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/tickets/mine` | attendee | Each ticket includes `short_code`, `status`, `qr_payload`, and `qr_image` (PNG data URL) |
| GET | `/tickets/:id` | attendee (owner) | |

## Organizer backup QR codes

For when an attendee didn't receive their ticket (failed delivery, lost phone, no app). Only the
**owning organizer** can use these; coordinators, gate staff and admins get 403. A QR is a bearer
credential, so every view and export is written to the audit log (`ticket.qr_viewed`, `ticket.qr_exported`).

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/events/:id/tickets?status=&q=` | owner organizer | Roster (no QR, no secrets). `q` matches name, email, or short code. Max 500 rows; `truncated: true` if there are more. |
| GET | `/events/:id/tickets/:ticketId/qr` | owner organizer | `{ ticket }` with `qr_payload` and `qr_image`, identical to the attendee's wallet copy |
| GET | `/events/:id/tickets/qr-sheet?status=&q=` | owner organizer | `{ tickets, truncated }` with QR images, for printing. Max 500. |

The gate treats an organizer-provided copy exactly like the attendee's own, so a ticket is still admitted only once.

## Gate check-in (FR-005, FR-006)

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/checkin/scan` | gate_staff | `{ event_id, payload }` (the raw QR text) |
| GET | `/checkin/lookup?event_id=&q=` | gate_staff | Search by short code, name or email |
| POST | `/checkin/manual` | gate_staff | `{ event_id, ticket_id, reason }` (reason required) |
| GET | `/checkin/recent?event_id=` | gate_staff | Last 30 entry-log rows |

Scan and manual check-in always return **200** with a verdict, so the gate UI has one code path:

```json
{ "valid": true,  "result": "accepted",  "message": "Welcome, Andrea Attendee!", "ticket": { "short_code": "GMHK-7E54", "attendee_name": "…", "ticket_type": "…", "status": "checked_in" } }
{ "valid": false, "result": "duplicate", "message": "Already checked in at 09:14 PM by Gio Gate.", "ticket": { … } }
```

`result` is one of `accepted`, `duplicate`, `invalid`, `wrong_event`, `not_active` (cancelled), or `expired`.
A closed event returns 409 before any validation runs.

## Notifications

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/notifications/mine` | any | `{ notifications, unread }` |
| POST | `/notifications/:id/read` | owner | 204 |
| POST | `/notifications/read-all` | any | 204 |
| GET | `/notifications` | admin | Full notification log |

## Audit (FR-007, FR-010)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/audit?entity_type=&entity_id=&action=&actor_id=&before=&limit=` | admin | Newest first. Page with `before=<next_before>`. |
| GET | `/audit/verify` | admin | `{ valid, checked, headHash }` or `{ valid: false, brokenAtId }` |
