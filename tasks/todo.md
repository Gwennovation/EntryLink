# EntryLink — Build Plan (v0.1 foundation)

Source spec: `../EntryLink_Project_Overview.docx` (SIA Theme No. 5).

## Repo layout (no npm workspaces — avoids React Native / React web version-hoisting conflicts)

```
entrylink/
├── apps/api      Node + Express REST API, PostgreSQL
├── apps/web      React (Vite) — Admin / Organizer / Coordinator / Gate Staff
├── apps/mobile   React Native (Expo) — Attendee
├── docs/         architecture.md, api.md (API contract — NFR-009)
└── tasks/        todo.md, lessons.md
```

## Key design decisions (flag if you disagree)
- **DB:** real PostgreSQL via `DATABASE_URL`; if unset, falls back to **PGlite** (Postgres compiled to WASM, file-backed) so the app runs with zero install. Same SQL either way.
- **Integration (spec 2.4):** in-process event bus. Ticketing publishes `ticket.issued` / `ticket.checked_in`; Notification, Audit, and Live-Dashboard services subscribe independently. Registration/Ticketing never call notification or audit code directly.
- **QR payload:** HMAC-signed token (`EL1.<ticketId>.<code>.<sig>`) so forged QR codes fail before any DB lookup. Duplicate scans are rejected atomically (`UPDATE … WHERE status='issued'`), which is race-safe with two gates.
- **Tamper-evident audit log:** append-only (DB trigger blocks UPDATE/DELETE) + SHA-256 hash chain; admin gets a "verify chain" endpoint.
- **Live dashboard:** Server-Sent Events (simpler than WebSockets; one-way is all we need).
- **Auth:** JWT with role claim, bcrypt; RBAC middleware enforcing separation of duties (spec 2.6).

## Checklist
### API
- [x] Schema + migrations: users, events, ticket_types, registrations, registration_history, tickets, entry_logs, comments, notifications, audit_logs
- [x] Auth (signup for attendees, login, me) + RBAC middleware
- [x] User management (admin) — FR-011
- [x] Event + ticket type management (organizer) — FR-009
- [x] Registration + proof upload (attendee), resubmit after revision — FR-001/002
- [x] Review workflow: approve / reject / request revision — FR-003
- [x] Auto ticket + QR generation on approval — FR-004
- [x] Gate scan + manual override, duplicate rejection — FR-005/006
- [x] Comments — FR-012; Notifications log — spec 2.1
- [x] Audit log + verify — FR-007/010, NFR-003
- [x] Stats, SSE live feed, end-of-event report (JSON + CSV) — FR-008/013
- [x] Seed script with demo accounts per role
- [x] Integration tests (node:test + supertest, in-memory PGlite) covering the full register → approve → scan → duplicate flow and RBAC denials

### Web
- [x] Login + role-based nav
- [x] Admin: users, audit log (+ verify)
- [x] Organizer: events, ticket types, live dashboard, report download
- [x] Coordinator: review queue, proof viewer, comments, actions
- [x] Gate: camera QR scanner + manual code entry, big valid/invalid result

### Mobile
- [x] Login / sign up
- [x] Browse events → register + upload proof
- [x] My registrations (status, comments, resubmit)
- [x] Ticket wallet (QR), notifications

### Docs
- [x] README (setup), docs/architecture.md, docs/api.md

## Review

**Verified**
- API: 31/31 integration tests pass (`npm test`), covering the full register → revise → approve → ticket → scan → duplicate flow, forged/tampered QR codes, wrong-event scans, capacity limits, reports and CSV, audit chain and immutability triggers, and a role-permission matrix.
- Live server: SSE dashboard updates on gate scans without a reload; `/audit/verify` passes on seeded plus live data.
- Web (browser pane): review queue, registration detail with the proof viewer, live dashboard (counts and gate feed update in real time), gate page (the camera fallback message shows when access is denied), audit log with verify, users page. `vite build` is clean.
- QR decode path: a real ticket payload rendered to a QR matrix decodes correctly with jsQR (the library the gate scanner uses).
- Mobile (Expo web at 375×812): login, events list, ticket screen, inbox with unread badge, registration detail with history. No console errors.

**Bugs found and fixed during verification**
1. Proof files returned 500: Express `sendFile` refuses paths under a dot-directory (`.data/uploads`). Fixed with `dotfiles: 'allow'`, and the tests now use a dot path so this is covered (the test failed before the fix and passes after).
2. The live feed showed "Unknown ticket" for rejected scans: `ticket.scan_rejected` now carries `attendee_name`.
3. Narrow viewports scrolled sideways because the grid column grew to fit wide tables. Fixed with `min-width: 0` on `main`.
4. The mobile tab label "Registrations" was cut off. Renamed to "Bookings".

**Not verified (needs a person or a device)**
- Live camera scanning (the browser pane blocks camera access). Decode logic is verified offline, but test on a phone over HTTPS or a tunnel.
- Mobile on a physical iOS/Android device through Expo Go, including the native image/PDF picker and the multipart upload shape `{ uri, name, type }`.
- Form submissions in the web and mobile UIs. Actions were driven through the API while the UI was checked for rendering; click through the README demo once yourself.
- Real PostgreSQL (`DATABASE_URL`). The same SQL runs on PGlite, but nobody has run it against a Postgres server yet.

**Follow-ups worth doing**
- Login rate limiting; a short-lived SSE stream token instead of the JWT in the query string.
- `npx expo lint` hasn't been run: it needs eslint config installed, and the registry was very slow today.

---

# Hardening pass (2026-09-29)

## Security (from the gap list)
- [x] 1. Login brute force: per-IP rate limits on auth routes + per-account lockout (5 fails → 15 min), constant-time response for unknown emails. `TRUST_PROXY` made explicit so X-Forwarded-For can't be spoofed to dodge limits.
- [x] 2. Uploads: verify file signature (magic bytes) matches an allowed type; store the detected type, not the client's claim; serve proofs with `CSP: sandbox`.
- [x] 3. Web sessions: httpOnly `SameSite=Strict` cookie instead of localStorage; CSRF guard (custom header required on cookie-authenticated writes); logout endpoint. Mobile keeps Bearer + SecureStore.
- [x] 5. Live feed: web uses the cookie, so the JWT-in-URL option is removed.
- [x] 4. CORS: refuse `*` in production; allowed origins must be listed.
- [x] 6. Web CSP in production builds; HSTS/frame-ancestors documented for the host.
- [x] Token revocation: `token_version` bumped on password change/reset so old tokens die.

## GitHub
- [x] CI workflow: API tests + web build on every push/PR
- [x] Dependabot config for npm (api, web, mobile) + GitHub Actions
- [ ] Ask before changing repo settings (branch protection, secret scanning)

## Review
- 74/74 API tests pass (18 new in `test/security.test.js`); web production build is clean.
- Verified in the browser against the production build (`vite preview`, real CSP): cookie sign-in (JS can't read the cookie; nothing in localStorage), live dashboard over the cookie-authenticated stream (a gate scan appeared instantly), proof preview under CSP, approval write through the CSRF check, sign-out clearing the session. No CSP violations.
- The new migration applied cleanly to the existing demo database.
- Not done here: GitHub repo settings (branch protection, secret scanning, Dependabot alerts) need your OK; CI only runs after the push.

## Later (not in this pass)
- Layout: mobile dark mode, accessibility review, check-in chart
- Database: managed Postgres with backups, least-privilege DB role

---

# Design & UX pass (2026-09-29), from the design critique

1. [x] Payment instructions on events: field in API + web form, required before publishing an event with paid tickets, shown on the mobile ticket and revision screens, seeded.
2. [x] "Already registered" state: `my_registration` on events for attendees; mobile event screen shows status + View ticket instead of the ticket picker; events list shows a badge.
3. [x] Contrast: input borders ≥3:1, dark-mode Approve/danger buttons, dark active nav, mobile placeholders. Re-run the contrast check.
4. [x] Tables: rows reachable by keyboard (real links); review queue shows Status first, event + ticket in one cell, counts on the tabs (`counts` from the API).
5. [x] Gate on phones: compact layout, live headcount, success/failure sounds (with a toggle), no Pause button when the camera is unavailable, 44px controls.
6. [x] Reject confirmation and a clearer "write a note to enable" hint.
7. [x] Clear "can't reach the server" message instead of "Request failed (404)".
8. [x] Mobile bookings: event date instead of submission date, View ticket shortcut, "My bookings" title.
9. [x] Consistency: no duplicate event title on mobile, centered button text on web.
10. [x] Mobile dark mode (follows the system theme).

## Review
- 82/82 API tests (8 new in `test/ux.test.js`); web build clean; mobile bundle compiles.
- Contrast: all 36 text/background pairs pass WCAG AA in light and dark (was 8 failures).
- Checked in the browser:
  - Web: login input borders, the review queue (status first, tab counts, keyboard-openable rows), the dark-mode Approve button, and the Reject confirmation (cancel leaves it pending).
  - Web gate at phone size, where a manual check-in showed ✓ and the headcount went 0 → 1, and the "can't reach server" message with the API stopped.
  - Mobile in dark and light: the events-list badges, "You're registered" on the event screen, bookings with event dates and View ticket, and payment instructions on the revision screen.
- Not verified: gate sounds (the browser pane can't play audio to me), the live camera, and the native iOS/Android dark mode (checked via Expo web only).
- Found during checks: a stale web dev server had lost its /api proxy (restart fixed it, no code change). The dark-mode header hairline was fixed with `headerShadowVisible: false`.

---

# Vercel deployment (2026-09-29): web + API in one Vercel project

Decisions: everything on Vercel (API as a Vercel Function), Neon Postgres + private Vercel Blob from Vercel's Storage tab, seed demo data.

- [x] Root `vercel.json`: install/build both apps, serve `apps/web/dist`, `/api/*` → function, SPA fallback, security headers (HSTS, frame, referrer, camera permissions)
- [x] `api/index.js` function wrapping the Express app (initialised once per instance)
- [x] Receipt storage: private Vercel Blob in production, local disk in dev/tests; upload cap 4 MB (Vercel body limit 4.5 MB)
- [x] Live dashboard works across function instances (DB polling) and closes before the 300 s limit (EventSource reconnects)
- [x] Migrations take an advisory lock (parallel cold starts)
- [x] Config from Vercel system env: DATABASE_URL/POSTGRES_URL, CORS origins, PUBLIC_WEB_URL, TRUST_PROXY
- [x] `SEED_DEMO=true` seeds demo data on first boot (no local credentials needed)
- [x] Tests for storage, cross-instance live feed, migration lock; simulate the function locally
- [x] Deploy guide in README; the user connects GitHub + Storage in the Vercel dashboard
- [x] Brand logo + favicons (user request mid-task): web favicons (light/dark), apple-touch icon, manifest, logo in sidebar/login/public page/poster/printed tickets; mobile app icon, Android adaptive layers, splash, sign-in logo; brand tokens moved to the logo purples (contrast re-checked, all pass).

## Review
- 88/88 API tests (6 new: cross-instance live feed + stream hand-off, Vercel function routing, one-time seed under concurrent boots, 4 MB cap, stored proof served from storage).
- Not verifiable here: a real Vercel deploy (needs the user's account). First deploy may surface a platform detail; `vercel logs` will show it.
