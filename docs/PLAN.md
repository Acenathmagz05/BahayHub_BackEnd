# BahayHub API — Sprint Plan (Nov 26 → Dec 6, 2026)

> **Solo build.** All tasks owned by Lugsanay. 11 days, deadline Dec 6.

## 1. Repo State (as of Nov 26)

- `nest new` done; standard `src/` scaffold only (app.module/controller/service/main)
- Dependencies installed: NestJS 12, TypeORM 1, pg, JWT, bcrypt, Helmet, Throttler, Swagger, class-validator, Joi, cookie-parser — Cloudinary not configured
- `.env.example` has only 6 of 14 required env vars (missing Cloudinary, PayMongo keys, etc.)
- No modules, entities, migrations, seeds, guards, filters, or tests
- No Render project or DB provisioned yet

---

## 2. Build Checklist (Nov 26 – Dec 6)

### Nov 26 — Foundation (CRITICAL — everything else depends on this)
- [ ] **Bootstrap** — `config/` (Joi validation of all 14 env vars), `common/` skeleton: `GlobalExceptionFilter`, `ResponseInterceptor`, `@Public`, `@Roles`, `@CurrentUser` decorators; `JwtAuthGuard`, `OptionalJwtAuthGuard`, `RolesGuard`, `WebhookSignatureGuard`. Wire `main.ts`: Helmet, CORS, `ValidationPipe` (whitelist, forbidNonWhitelisted, transform), rawBody, cookie-parser, Throttler, Swagger at `/api/docs`. Update `.env.example` to full 14-var spec. _Done when:_ `nest start` compiles with no errors; `GET /` returns `{"success":true,"data":null}`.
- [ ] **DB setup** — Provision Render Postgres; write `database/data-source.ts`; migration 001 (roles → users → refresh_tokens) with seed for 3 roles; run locally. _Done when:_ `migration:run` completes; `SELECT * FROM roles` = 3 rows.
- [ ] **`auth/` module** — `register`, `login`, `refresh`, `logout`, `GET /auth/me`; JWT strategy (access 15 min + refresh 7 d, rotating, transaction); `refresh_tokens` entity. _Done when:_ Supertest: register → login → refresh → reuse-rotated-token (401 `TOKEN_REVOKED`) → logout all pass; suspended user rejected on refresh.

### Nov 27 — Core DB + Users
- [ ] **Migrations 002–008** — property_types → addresses → properties → property_images → amenities → property_amenities → favorites. All indexes and partial unique constraints from skill spec (GIN, is_primary partial, etc.). _Done when:_ `migration:run` clean; all tables and indexes exist.
- [ ] **`users/` + `roles/`** — CRUD (admin), `GET /users/me`, `PATCH /users/me`, `PATCH /users/me/password`. _Done when:_ Postman: admin creates agent; client `POST /users` → 403.

### Nov 28 — Remaining Migrations + Properties
- [ ] **Migrations 009–015** — inquiries → inquiry_messages → appointment_status (seed ids 1–4, reset sequence) → appointments → payment_logs enums + table. _Done when:_ migration runs clean; `SELECT id, name FROM appointment_status` = 4 rows.
- [ ] **`properties/` CRUD + search** — listing CRUD, ownership rules, `OptionalJwtAuthGuard` on public read (`isFavorite`, phone visibility). Search: `q, listingType, typeId, barangay, minPrice, maxPrice, bedrooms, bathrooms, amenityIds, status, sort`. `/properties/mine` before `/:id`. _Done when:_ `GET /properties?barangay=Libertad` filters; guest gets no phone/`isFavorite`; agent edits own only (403 otherwise).
- [ ] **Catalogs** — `property-types/`, `amenities/` (CRUD admin, delete blocked if in use), `meta/barangays`, `appointment-statuses/`. _Done when:_ all 4 `GET` catalog endpoints return data; admin-only write routes 403 for client.

### Nov 29 — Images + Favorites + Inquiries
- [ ] **`property-images/`** — Cloudinary upload; MIME + magic-byte check; ≤5 MB, ≤15/listing; `is_primary` partial unique. _Done when:_ upload returns `imageUrl`; 16th upload → 409; wrong MIME → 415.
- [ ] **`favorites/`** — idempotent POST, DELETE, GET (client only). _Done when:_ double-add returns 201 with same row, no duplicate.
- [ ] **`inquiries/`** — `POST /properties/:id/inquiries` (client); GET list (scoped by role); GET detail; GET/POST messages; PATCH status; DELETE (admin). `replied` auto-sets on first agent message. _Done when:_ Postman: client posts → agent replies → status = `replied` automatically.

### Nov 30 — Appointments
- [ ] **`appointments/`** — POST (30-min boundary, 60-day window, 08:00–18:00 Manila, double-booking check via partial unique index); GET list/detail; PATCH transitions (all allowed paths from skill; finals → 409; non-30-min time → 400). _Done when:_ Supertest covers every listed transition; cancelled slot can be rebooked; pending/confirmed slot → 409.

### Dec 1 — Payments + Admin
- [ ] **`payments/`** — POST checkout (lazy expiry, idempotency key, `forbidNonWhitelisted` blocks body `amount`, PayMongo session); GET list/detail; PATCH refund (admin, paid→refunded). _Done when:_ no-fee listing → 409 `PROPERTY_NOT_PAYABLE`; second open payment → 409 `PAYMENT_ALREADY_PENDING`; `amount` in body → 400.
- [ ] **Webhook handler** — raw-body HMAC verify (timing-safe), 5-min timestamp check, idempotent, amount mismatch → failed + alert, marks paid + paid_at + method. _Done when:_ valid → 200 idempotent; bad sig → 401; old timestamp → 401; mismatch → `failed` row.
- [ ] **`admin/stats`** — total listings, users by role, appointments by status, verified payment totals. Rate-limit tuning (global 100/min; login 5/min; payment 10/min). _Done when:_ `GET /admin/stats` returns all fields; hammer login 6× → 429.

### Dec 2 — Swagger + Postman
- [ ] **Swagger** — decorators on all controllers and DTOs; `GET /api/docs` loads all 56 endpoints with correct schemas and auth locks. _Done when:_ Swagger UI loads; every route visible with request/response examples.
- [ ] **Postman collection** — full CRUD, auth flows, error cases, webhook replay using sandbox keys. Runnable with Newman. _Done when:_ `newman run postman/collection.json -e postman/env.json` exits 0.

### Dec 3 — Tests + Seed
- [ ] **Jest unit tests** — services: auth (rotation, suspended, reuse-rotated), appointments (all transitions), payments (no-fee, double-open, lazy expiry, idempotency), webhook (sig, replay, mismatch). Target ≥70% statement coverage. _Done when:_ `npm test -- --coverage` passes threshold.
- [ ] **Seed script** — 1 admin, 3 agents, 5 clients, ~20 Butuan listings (3–5 photos, ~half with `reservation_fee`), 10 appointments across all 4 statuses (one cancelled slot later rebooked), 5–6 sandbox `payment_logs`. Idempotent. _Done when:_ `npm run seed` runs twice with no errors or duplicates.

### Dec 4 — Integration + Hardening
- [ ] **Newman full pass** on staging (Render). Fix any failures.
- [ ] **Security audit** — `.env.example` matches all 14 vars; Joi rejects missing keys at startup; no stack traces leak; all parameterized queries; HTML stripped from free-text fields; upload MIME + magic-byte enforced.
- [ ] **`storage/` (Cloudinary service)** — finalize if not done during images step.

### Dec 5 — Deploy + Frontend Handoff
- [ ] **Final Render deploy** from `main`. Verify HTTPS, HSTS header, CORS origin allow-list, DB TLS. _Done when:_ `curl https://<render-url>/api/docs` returns 200.
- [ ] **Frontend integration smoke test** with partner pair SPA. Fix any contract breaks.

### Dec 6 — Demo
- [ ] Final Newman run on production URL, screenshots, submission.

---

## 3. Critical Path & First 3 Tasks Today

The entire project unblocks in this order:
> **Bootstrap → DB migration 001 → auth → remaining migrations → features**

### ✅ Do These First Right Now (Nov 26)

1. **`config/` + `common/` + `main.ts`** — Joi env validation, GlobalExceptionFilter, ResponseInterceptor, all 4 guards, all 3 decorators, full `main.ts` wiring. This is the skeleton every other module imports.

2. **`config/` env audit** — Update `.env.example` to full 14-var list (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGIN`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `PAYMENT_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET`, `PAYMENT_SUCCESS_URL`, `PAYMENT_CANCEL_URL`, `NODE_ENV`, `PORT`, `THROTTLE_TTL`/`THROTTLE_LIMIT` or similar). Verify: missing `JWT_ACCESS_SECRET` → readable startup error, no stack trace.

3. **Migration 001 + `auth/` module** — Provision Render DB, write the first 3-table migration, then build the full `auth/` module with token rotation in a transaction. Auth is the highest-risk module (most edge cases, most tests); getting it done tonight leaves the remaining 9 days for features.

---

## 4. Cut Line

> From skill: *"If auth, properties, and appointments are not finished by Dec 2, reduce payments to the `payment_logs` table, the three read endpoints, and a seeded sandbox sample; document the webhook as designed but not deployed."*

**Drop order if you slip:**

| # | Drop first | Keep |
|---|---|---|
| 1 | Live webhook handler | `payment_logs` table + read endpoints + seed data |
| 2 | Live PayMongo checkout session | Schema + GET endpoints + Postman mocks |
| 3 | Payment totals in `admin/stats` | Other stat fields (listings, users, appointments) |
| 4 | Appointment reschedule (client PATCH) | POST + confirm/cancel/complete agent transitions |
| 5 | `property-images/` Cloudinary upload | Property CRUD without photos (use placeholder URLs in seed) |

**Never drop:** auth, properties (read + CRUD), inquiries (POST + GET), appointments (POST + all status transitions), migrations, seeds, Swagger docs.
