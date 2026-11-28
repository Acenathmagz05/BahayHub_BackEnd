# BahayHub API: Revised Sprint Plan (Nov 26 to Dec 6, 2026)

Solo build with AI. Payments removed; `reservations` added (see SKILL.md, "Reservations").
Rule: finish each module together with its tests before starting the next.

## Nov 26: Foundation

- [ ] `config/` (Joi, env vars: DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, CORS_ORIGIN, CLOUDINARY_*, NODE_ENV), `common/` (filter, interceptor, decorators, Jwt/OptionalJwt/Roles guards), `main.ts` (Helmet, CORS, ValidationPipe, cookie-parser, Throttler, Swagger). Enable the `@nestjs/swagger` CLI plugin in `nest-cli.json`.
      _Done when:_ `nest start` compiles; `GET /api/docs` loads; missing `JWT_ACCESS_SECRET` gives a readable startup error.
- [ ] Render Postgres + migration 001 (roles, users, refresh_tokens) + 3 role seeds.
      _Done when:_ `migration:run` works locally; `SELECT * FROM roles` returns 3 rows.
- [ ] Deploy the empty API to Render. Create Cloudinary account.
      _Done when:_ `https://<render-url>/api/docs` returns 200.

## Nov 27: Auth

- [ ] `auth/` (register, login, refresh with rotation in a transaction, logout, `/auth/me`) + `refresh_tokens` entity.
      _Done when (Supertest):_ register, login, refresh, reuse of rotated token gives 401 `TOKEN_REVOKED`, logout; suspended user rejected on login and refresh.

## Nov 28: Remaining migrations + Users

- [ ] Migrations 002 to 014 in order: property_types, addresses, properties, property_images, amenities, property_amenities, favorites, inquiries, inquiry_messages, appointment_status (seed ids 1 to 4, reset sequence), appointments, `reservation_status` enum, reservations. All partial unique indexes and CHECKs.
      _Done when:_ clean `migration:run` on an empty DB; `appointment_status` has 4 rows; the 4 partial indexes exist.
- [ ] `users/` + `roles/`.
      _Done when:_ admin creates an agent; client `POST /users` gives 403.

## Nov 29: Catalogs + Properties

- [ ] `property-types/`, `amenities/`, `meta/barangays`, `appointment-statuses/`.
- [ ] `properties/` CRUD + search (QueryBuilder, no `undefined` in `where`), ownership checks, `/properties/mine` before `/:id`, guest vs logged-in fields.
      _Done when:_ `GET /properties?barangay=Libertad` filters; guest gets no phone or `isFavorite`; agent editing another agent's listing gets 403.
- [ ] Share the deployed Swagger URL with the frontend pair (contract changes: no payments, reservations added).

## Nov 30: Images + Favorites + Inquiries

- [ ] `property-images/` (Cloudinary; MIME + signature check; 5 MB; 15 per listing). _Done when:_ 16th upload gives 409, wrong type 415.
- [ ] `favorites/` (idempotent add). `inquiries/` (+ messages, `replied` set on first agent reply).

## Dec 1: Appointments (checkpoint)

- [ ] `appointments/` (30-minute slots, 60-day window, 08:00 to 18:00 Manila, double-booking via partial index, all transitions).
      _Done when (Supertest):_ every allowed transition passes, every other gives 409; cancelled slot can be rebooked; pending/confirmed slot gives 409.
- [ ] **Evening checkpoint:** if auth, properties, appointments are not passing, reservations ships minimal (see cut line).

## Dec 2: Reservations + Admin stats

- [ ] `reservations/`: create, list, detail, PATCH transitions with property status sync in one transaction (confirm locks the property row).
      _Done when:_ confirm sets property `reserved`; second confirm gives 409 `PROPERTY_ALREADY_RESERVED`; cancelling a confirmed one releases the property; complete sets `sold`/`rented` by `listing_type` and auto-cancels other pending ones; property status PATCH with a confirmed reservation gives 409.
- [ ] `admin/stats` (users by role, listings by status, appointments and reservations by status).

## Dec 3: Seed + Postman

- [ ] Idempotent seed script (1 admin, 3 agents, 5 clients, about 20 listings, 10 appointments, 5 to 6 reservations; at most one confirmed per property).
      _Done when:_ `npm run seed` twice with no errors or duplicates.
- [ ] Postman collection (CRUD, auth, errors, reservation flow); `newman run` exits 0.

## Dec 4: Coverage + Hardening

- [ ] Jest coverage on services at 70% or more; fill gaps (auth rotation, appointment transitions, reservation transitions).
- [ ] Newman on the Render deploy. Security pass: no stack traces in production, HTML stripped from free text, parameterized queries only, `.env.example` complete.

## Dec 5: Final deploy + Frontend integration

- [ ] Deploy from `main`; verify HTTPS, HSTS, CORS allow-list, DB TLS, cookie settings across the frontend origin.
- [ ] Smoke test with the frontend pair; fix contract breaks only.

## Dec 6: Buffer + Demo

- [ ] Final Newman run on production, screenshots, update the written report (remove all payment sections).

## Cut line (decide on the evening of Dec 1)

Drop in this order if slipping:

1. `completed` transition and stats breakdown for reservations.
2. Client reschedule on appointments.
3. Cloudinary uploads (use placeholder URLs in the seed).

Never drop: auth, properties, inquiries, appointments, reservations create/confirm/cancel, migrations, seed, Swagger.
