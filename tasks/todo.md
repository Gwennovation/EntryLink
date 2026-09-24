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
- [ ] Schema + migrations: users, events, ticket_types, registrations, registration_history, tickets, entry_logs, comments, notifications, audit_logs
- [ ] Auth (signup for attendees, login, me) + RBAC middleware
- [ ] User management (admin) — FR-011
- [ ] Event + ticket type management (organizer) — FR-009
- [ ] Registration + proof upload (attendee), resubmit after revision — FR-001/002
- [ ] Review workflow: approve / reject / request revision — FR-003
- [ ] Auto ticket + QR generation on approval — FR-004
- [ ] Gate scan + manual override, duplicate rejection — FR-005/006
- [ ] Comments — FR-012; Notifications log — spec 2.1
- [ ] Audit log + verify — FR-007/010, NFR-003
- [ ] Stats, SSE live feed, end-of-event report (JSON + CSV) — FR-008/013
- [ ] Seed script with demo accounts per role
- [ ] Integration tests (node:test + supertest, in-memory PGlite) covering the full register → approve → scan → duplicate flow and RBAC denials

### Web
- [ ] Login + role-based nav
- [ ] Admin: users, audit log (+ verify)
- [ ] Organizer: events, ticket types, live dashboard, report download
- [ ] Coordinator: review queue, proof viewer, comments, actions
- [ ] Gate: camera QR scanner + manual code entry, big valid/invalid result

### Mobile
- [ ] Login / sign up
- [ ] Browse events → register + upload proof
- [ ] My registrations (status, comments, resubmit)
- [ ] Ticket wallet (QR), notifications

### Docs
- [ ] README (setup), docs/architecture.md, docs/api.md

## Review
_(filled in after verification)_
