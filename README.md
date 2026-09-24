# EntryLink

Smart event registration, QR ticketing, and crowd entry management. Built for Cityscape Events
Management Inc. (SIA project, Theme No. 5).

An attendee registers in the **mobile app** and uploads proof of payment. A coordinator approves it
on the **web dashboard**. The system then issues a signed QR ticket automatically. Gate staff scan it,
duplicates are rejected, and the organizer's live dashboard updates in real time. Every step is written
to a tamper-evident audit trail.

| App | Stack | Users |
|---|---|---|
| [`apps/api`](apps/api) | Node.js, Express 5, PostgreSQL | REST API for both clients |
| [`apps/web`](apps/web) | React 19 + Vite | Admin, Organizer, Coordinator, Gate Staff |
| [`apps/mobile`](apps/mobile) | React Native (Expo, Expo Router) | Attendees |

Docs: [architecture & integration design](docs/architecture.md) · [API contract](docs/api.md)

## Quick start

Requires Node 20+. No database install needed: without `DATABASE_URL`, the API runs
[PGlite](https://pglite.dev), a real PostgreSQL build that runs in-process and stores data in `apps/api/.data/`.

```bash
npm run install:all
```

```bash
npm run seed
```

Then run each of these in its own terminal:

```bash
npm run api
```

```bash
npm run web
```

```bash
npm run mobile
```

- API: http://localhost:4000/api/health
- Web dashboard: http://localhost:5173
- Mobile: scan the Expo QR code with **Expo Go** (your phone must be on the same Wi-Fi), or press `w` to open it in a browser

### Demo accounts

All demo accounts use the password `EntryLink123!`.

| Role | Email | Where |
|---|---|---|
| System Admin | admin@entrylink.test | web |
| Event Organizer | organizer@entrylink.test | web |
| Registration Coordinator | coordinator@entrylink.test | web |
| Gate Staff | gate@entrylink.test | web (open `/gate` on a phone or laptop with a camera) |
| Attendee | attendee@entrylink.test, juan@…, maria@… | mobile |

The seed creates an event that is **happening now** (for trying the gate) and a future conference,
with registrations in pending, approved, and revision-requested states.

To reset the data, delete `apps/api/.data` and run `npm run seed` again.

### End-to-end demo

1. **Mobile** (as maria@): the registration is pending. Or sign up as a new attendee, open an event, pick a ticket, and upload any image as the receipt.
2. **Web** (as coordinator@): open the Review queue, open the registration, check the proof, and approve it.
3. **Mobile**: an inbox notification appears and the QR ticket shows up under Tickets.
4. **Web** (as organizer@): open *Metro Manila Career Fair → Live dashboard* in one window.
5. **Web** (as gate@, ideally on a phone): open Gate scanner and scan the ticket. You'll see green ✓, and the organizer's dashboard ticks up instantly. Scan the same ticket again and you'll see red **Duplicate**.
6. **Web** (as admin@): open the Audit log and click **Verify integrity**.

> Camera access in the browser requires HTTPS or `localhost`. To use a phone as the gate scanner
> during development, tunnel the web app (e.g. `npx localtunnel --port 5173`) or use **Manual
> check-in** (search by ticket code or name).

## Using real PostgreSQL

```bash
cp apps/api/.env.example apps/api/.env
```

Then set `DATABASE_URL=postgres://…` in that file (local Postgres, Supabase, or Neon all work).
Migrations run automatically on start.

## Tests

```bash
npm test
```

These are API integration tests on an in-memory database. They cover the full register → revise →
approve → ticket → scan → duplicate flow, forged QR codes, capacity limits, reports, the audit chain
and immutability, and a role-based access matrix (including separation of duties).

## Requirements traceability

| Req | Where |
|---|---|
| FR-001/002 register + proof upload | `POST /registrations` · mobile `event/[id]` |
| FR-003 approve / reject / revise | `services/registrations.js` · web Review |
| FR-004 auto QR ticket | `review()` → `issueTicket()` → `ticket.issued` event |
| FR-005/006 scan, check-in, duplicates | `services/checkin.js` (atomic update) · web Gate |
| FR-007/010 logging & audit | `services/audit.js` (hash chain) + DB trigger |
| FR-008 real-time dashboard | SSE `GET /events/:id/live` · web Live dashboard |
| FR-009 events, ticket types, capacity | `routes/events.js` · web Events |
| FR-011 user admin | `routes/users.js` · web Users |
| FR-012 comments | `/registrations/:id/comments` · both clients |
| FR-013 end-of-event report | `/events/:id/report[?format=csv]` |
| FR-014 / NFR-002 RBAC | `requireRole()` + ownership checks · `test/rbac.test.js` |
| NFR-005 scan < 2s | asserted in `test/flow.test.js` |
| NFR-009 onboarding | this README + `docs/` |

## Out of scope (per spec)

No live payment gateway (proof of payment is verified manually), no offline scanning, no seat
assignment, no hardware turnstiles, and a single organization only.
