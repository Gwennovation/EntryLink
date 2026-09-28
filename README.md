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

## Testing on a phone

You need your phone and this computer on the **same Wi-Fi**, and **Expo Go** installed on the phone
(App Store / Play Store). Find your computer's Wi-Fi IP address (macOS: `ipconfig getifaddr en0`).
The examples below use `192.168.1.13`; replace it with yours.

**1. Start the API so poster QR codes link to your computer instead of `localhost`:**

```bash
PUBLIC_WEB_URL=http://192.168.1.13:5173 npm run api
```

**2. Start the web app so other devices on the Wi-Fi can open it, and point the "Register in the app" button at Expo Go:**

```bash
cd apps/web && VITE_APP_LINK_BASE="exp://192.168.1.13:8081/--/" npx vite --host
```

**3. Start the mobile app and open it in Expo Go** by scanning the QR code shown in the terminal:

```bash
npm run mobile
```

### What to try

| Feature | Steps | Expected |
|---|---|---|
| **Poster QR** | Web as organizer@ → Metro Manila Career Fair → **Poster QR**. Point your phone's normal camera at the QR on your screen. | The phone opens the event page. Tap **Register in the EntryLink app**: Expo Go opens the event's registration screen. If you're signed out, you sign in first and then land on the event. |
| **Registration from the poster** | Continue in the app: pick a ticket, upload any image as the receipt, submit. | It appears in the web Review queue (as coordinator@). |
| **Resend ticket** | Web as organizer@ → event → **Tickets & QR codes** → **Show QR** on an attendee → **Resend ticket**. | That attendee's app inbox shows "Your ticket (sent again)", and tapping it opens the ticket. The web notification log (admin@) lists the email as "Not sent — no email provider". |
| **Backup QR at the gate** | **Download PNG** or **Print** a ticket, then scan it with the gate scanner. | The first scan is accepted; scanning it again, or the attendee's own copy, shows **Duplicate**. |
| **Gate camera on a phone** | Phone browsers only allow the camera over HTTPS, so run `npx localtunnel --port 5173` and open that https URL as gate@. | Scanning a ticket shows green ✓. |

If the phone can't load anything, check that both devices are on the same Wi-Fi and that your
computer's firewall allows incoming connections on ports 4000, 5173 and 8081.

> **Expo Go vs. the real app.** Expo Go only understands `exp://` links. A dev or production build
> of EntryLink uses `entrylink://` instead (the default `VITE_APP_LINK_BASE`), so in production the
> poster → app hand-off works without any extra settings.

## Email

Nothing is emailed yet: the spec simulates notifications. The pieces are already in place, though.
When a ticket is issued or an organizer presses **Resend ticket**, `services/email.js` builds the
email with the QR attached and records the attempt in the notification log as "not sent". To go
live, implement a transport for your provider (SendGrid, SES, SMTP…) in that file and set
`EMAIL_PROVIDER`. Failed sends appear in the log as "Failed", and the organizer can resend or
hand over a printed or downloaded QR.

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

## Deploying securely

No system is unhackable, but these settings close the common holes. The API refuses to start in
production if the first three are missing.

- [ ] `NODE_ENV=production`, plus long random `JWT_SECRET` and `QR_SECRET` (`openssl rand -base64 48`). Never commit them.
- [ ] `CORS_ORIGINS=https://your-web-domain`: only your web app may call the API from a browser.
- [ ] HTTPS everywhere. Most hosts (Render, Railway, Vercel, Netlify) do this automatically. Session cookies are HTTPS-only in production.
- [ ] Serve the web app and API on **one origin**, with the host proxying `/api/*` to the API. The session cookie is `SameSite=Strict` and scoped to `/api`, so this is required.
- [ ] `TRUST_PROXY=1` if the API sits behind exactly one proxy or load balancer, so rate limits see real client IPs.
- [ ] Set these headers on the **web host** (a `<meta>` tag can't): `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), and `Referrer-Policy: strict-origin-when-cross-origin`. The API sets its own through Helmet.
- [ ] Managed PostgreSQL (`DATABASE_URL`) with automatic daily backups (spec NFR-008), connected with a database user that isn't a superuser.
- [ ] Change or remove the seeded demo accounts. The demo password is public in this repo.
- [ ] On GitHub: Dependabot alerts, secret scanning with push protection, and branch protection for `main` requiring CI to pass.

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
| Backup ticket delivery | Organizer *Tickets & QR codes* page: view, download, or print any attendee's QR (audited) |
| Poster QR → registration | Organizer *Poster QR* page → public `/e/:id` page → app deep link `event/[id]` |
| Resend ticket | *Tickets & QR codes* → Resend → `ticket.resent` event → in-app inbox + email hook |
| FR-014 / NFR-002 RBAC | `requireRole()` + ownership checks · `test/rbac.test.js` |
| NFR-005 scan < 2s | asserted in `test/flow.test.js` |
| Security hardening | `test/security.test.js`: lockout, rate limits, upload sniffing, cookie + CSRF, revocation, config guards |
| NFR-009 onboarding | this README + `docs/` |

## Out of scope (per spec)

No live payment gateway (proof of payment is verified manually), no offline scanning, no seat
assignment, no hardware turnstiles, and a single organization only.
