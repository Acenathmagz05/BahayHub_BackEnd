---
name: bahayhub-backend
description: Project rules, schema, API contract, and conventions for the BahayHub backend (NestJS + TypeORM + PostgreSQL real estate listing platform for Butuan City, ITE 18 midterm/final project, Rev 2). Use this skill whenever the user mentions BahayHub, the Butuan real estate API, ITE 18 backend work, or asks to write, review, or debug any NestJS module, TypeORM entity, migration, seed, DTO, guard, Swagger doc, Postman test, or documentation for properties, listings, inquiries, appointments, favorites, reservations, refresh tokens, or roles in this project. Also use it when updating the backend documentation, ERD/DBML, data dictionary, or frontend-backend API contract, even if the user does not say "BahayHub" explicitly.
---

# BahayHub Backend

Backend for **BahayHub**, a real estate listing and inquiry platform for **Butuan City, Agusan del Norte** only. Course: ITE 18 (Application Development and Emerging Technologies), Caraga State University. Team: Lugsanay and Magbanua (original Rev 2 split). For the Final, Lugsanay builds the whole backend with AI assistance; Magbanua reviews PRs and runs the Postman/Newman collection (see Working mode). The frontend is a separate TypeScript SPA built by the partner pair. **The API contract in this file is shared with them. Never change a route, field name, or error code without flagging it as a contract change.**

Status: Rev 2 design is the pre-development baseline. Source code is built for the Final (target Dec 6, 2026).

**Design change since Rev 2 ("Rev 3")**: BahayHub does not process payments. Payment happens face to face between client and agent. The PayMongo gateway, webhook, and `payment_logs` table from Rev 2 are **removed and must not be implemented**. They are replaced by a `reservations` table and 4 endpoints (see Reservations). Where the Rev 2 PDF disagrees with this file, this file wins.

## How to use this skill

1. Before writing code, check the relevant section below (schema, API, auth, reservations).
2. Generate code that matches these conventions exactly. If the user's request conflicts with the contract, say so before proceeding.
3. When you add or change a route, column, enum, or error code, list which docs must be updated (data dictionary, DBML, Swagger, Postman, frontend mapping table).
4. If something is not specified here, ask or state your assumption. Do not invent endpoints or columns silently.

## Stack (fixed by the course and the design)

| Concern       | Choice                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework     | NestJS 12 (Node.js 22.12+ or 20.19+, TypeScript 6), modular monolith                                                                                  |
| DB            | PostgreSQL 15+                                                                                                                                        |
| ORM           | TypeORM with versioned migrations. `synchronize` is **never** true outside throwaway local dev                                                        |
| Auth          | JWT access (15 min) + rotating refresh token (7 days, httpOnly cookie) tracked in `refresh_tokens`                                                    |
| Validation    | class-validator + class-transformer, global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`)                                       |
| Images        | Cloudinary (never local disk)                                                                                                                         |
| Payments      | None. The reservation fee, if any, is settled in person. BahayHub only records reservations                                                           |
| Hosting       | Render (web service + managed Postgres), deploys from `main`                                                                                          |
| Docs/tests    | Swagger at `/api/docs` (enable the `@nestjs/swagger` CLI plugin in `nest-cli.json` so DTO schemas are generated), Postman (+ Newman), Jest, Supertest |
| Security libs | Helmet, `@nestjs/throttler`, bcrypt (cost 12), cookie-parser                                                                                          |

## Installed versions and pitfalls (read before generating any code)

Installed in the repo: `@nestjs/* ^12`, `typeorm ^1.1.2`, `@nestjs/typeorm ^12`, `@nestjs/throttler ^6.7.1`, `class-validator ^0.15`, `class-transformer ^0.5`, `joi ^18`, `bcrypt ^6`, `helmet ^8`, `passport-jwt ^4`, `pg ^8`.

Your training data likely favors **NestJS 11 and TypeORM 0.3**. Do not write code from memory of those versions. When unsure of an API, check the installed package's types or docs first.

- **Node**: runtime needs 20.19+ or 22.12+. The Nest CLI (`nest new/generate/upgrade`) needs newer minimums (22.22.3+ or 24.15+). Verify with `node -v` before debugging odd errors.
- **TypeScript 6**, `tsconfig` target `ES2023` (TypeORM 1.x minimum target).
- **TypeORM 1.x removed or changed**: `findByIds` / `findOneById` (use `findBy` with `In`), the `Connection` alias (use `DataSource`), `TYPEORM_*` env vars and dotenv auto-loading (configure `DataSource` explicitly from the validated config), `sqlite3`/`mysql` drivers, legacy naming strategies moved to `@typeorm/legacy-naming-strategies`. Invalid `where` values now **throw** instead of being ignored, so **never pass `undefined` into `where`**. Build optional search filters conditionally with QueryBuilder.
- **Postgres enums**: TypeORM 1.x uses `ALTER TYPE ... ADD VALUE` when adding enum values. Still write enum types and partial indexes as raw SQL in migrations.
- **Joi 18** works with Nest 12 config validation (Joi must be v18+).
- **Throttler 6** may not list Nest 12 as a declared peer. If it causes problems, check `npm ls @nestjs/throttler` before changing anything else.
- Nest 12 packages are ESM-ready, but CommonJS projects keep working via `require()` on supported Node versions. Keep the project's existing module format; do not convert it to ESM unless asked.

## Architecture rules

Request pipeline: middleware (Helmet, CORS allow-list, throttler, cookie-parser, logger) → guards (JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard) → ValidationPipe → controller → service → repository → PostgreSQL.

| Layer                | Does                                                                                                                                                                       | Must not                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Controller           | Route + method mapping, read DTOs, return result                                                                                                                           | Business rules, DB access                  |
| Service              | Ownership checks, status transitions, double-booking check, bcrypt, token rotation, pagination, reservation transitions that update the property status in one transaction | Touch `req`/`res`                          |
| Repository (TypeORM) | Only layer that talks to Postgres: queries, transactions                                                                                                                   | Decide who may do what                     |
| DTO/Entity           | DTOs validate/shape I/O; entities map tables                                                                                                                               | Expose `password_hash` or internal columns |
| Guards/Pipes/Filters | Authn, role checks, validation, signature check, uniform errors                                                                                                            | Hold feature logic                         |

- Guards check **role**; services check **ownership**.
- A global exception filter and response interceptor produce the response envelopes below.

### Folder structure (corrected)

```
bahayhub-api/
├── src/
│   ├── main.ts                   # Helmet, CORS, ValidationPipe, Swagger
│   ├── app.module.ts
│   ├── config/                   # env loading + Joi validation
│   ├── common/                   # @Roles @Public @CurrentUser, guards, filters, interceptors, pipes, shared DTOs
│   ├── database/                 # data-source.ts, migrations/, seeds/
│   ├── auth/                     # controller, service, JWT strategy, refresh-token store
│   ├── users/  roles/
│   ├── properties/               # listing CRUD, search filters, ownership rules
│   ├── property-images/
│   ├── property-types/  amenities/
│   ├── favorites/  inquiries/    # inquiries includes messages
│   ├── appointment-statuses/     # lookup + state metadata
│   ├── appointments/             # viewing requests, double-booking check, status_id FK
│   ├── reservations/             # reservation requests, status transitions, property status sync
│   ├── meta/                     # barangay list
│   ├── admin/                    # dashboard stats (incl. reservations by status)
│   └── storage/                  # Cloudinary service
├── test/                         # Supertest e2e specs
├── postman/                      # exported collection + environments
├── .env.example  .gitignore  nest-cli.json  package.json  README.md
```

Each feature folder has `*.module.ts`, `*.controller.ts`, `*.service.ts`, `entities/`, `dto/`.

### Naming

- DB columns `snake_case`; API JSON fields `camelCase` (`first_name` → `firstName`).
- Branches: `main` (protected) ← `develop` ← `feature/<module>-<task>` / `fix/<issue>`. PRs reviewed by the other member.
- Commits: Conventional Commits, e.g. `feat(properties): add search filters`.

## Database (15 tables, 3NF with 1 documented exception)

Migration order: `roles → users → refresh_tokens → property_types → addresses → properties → property_images → amenities → property_amenities → favorites → inquiries → inquiry_messages → appointment_status → appointments → reservations`. Create the `reservation_status` enum before `reservations`. Seed `appointment_status` in the same migration that creates it, with explicit ids 1–4, then reset the sequence.

### Conventions

- PKs: `bigint` identity (uuid for token `jti`). Junction tables use composite PKs.
- Money: `numeric(14,2)` (PHP). Area: `numeric(10,2)`. Add a column transformer so `price`, `reservation_fee`, `amount`, and areas return as **numbers** (pg returns numeric/bigint as strings).
- Time: `timestamptz` in UTC; frontend displays Asia/Manila.
- Soft delete (`@DeleteDateColumn`) on `users` and `properties` only. History tables use `ON DELETE RESTRICT`.
- `reservations` rows are never deleted (no DELETE route, no soft delete). History is kept through `status` and the `confirmed_at` / `cancelled_at` / `completed_at` timestamps.
- Load relations with explicit joins (avoid N+1). `password_hash` is `select: false`.

### Enums

`user_status` (active, inactive, suspended) · `listing_type` (sale, rent) · `property_status` (available, reserved, sold, rented) · `inquiry_status` (new, read, replied, closed) · `reservation_status` (pending, confirmed, cancelled, completed). Appointment states are **not** an enum: they live in `appointment_status`.

### Tables (key columns)

- **roles**: id, name (UQ: admin/agent/client), description
- **users**: id, role_id→roles, first_name(60), last_name(60), email(150, UQ, lowercase), password_hash(255), phone(20, optional), status, created_at/updated_at, deleted_at
- **refresh_tokens**: id, user_id→users (CASCADE), jti uuid (UQ), expires_at, revoked_at, replaced_by_jti, created_at
- **property_types**: id, name(50, UQ)
- **addresses**: id, street(255), barangay(100; nullable in DB, required by API), city (default Butuan City), province (default Agusan del Norte), postal_code (default 8600), country (default Philippines)
- **properties**: id, agent_id→users, type_id→property_types, address_id→addresses (UQ, 1:1), title(150), description text, price (>0), **reservation_fee** (informational only, no online payment; NULL or >0 and ≤ price), listing_type, status (default available), bedrooms/bathrooms (0–50), floor_area_sqm, lot_area_sqm (>0), timestamps, deleted_at
- **property_images**: id, property_id→properties (CASCADE), image_url(500), caption(150), is_primary, sort_order
- **amenities**: id, name(50, UQ), icon(50) · **property_amenities**: (property_id, amenity_id) composite PK, both CASCADE
- **favorites**: (user_id, property_id) composite PK, CASCADE, created_at
- **inquiries**: id, property_id, client_id, message (CHECK length 10–2000), status (default new), created_at (RESTRICT FKs)
- **inquiry_messages**: id, inquiry_id (CASCADE), sender_id (RESTRICT), message (1–2000), created_at
- **appointment_status**: id (GENERATED BY DEFAULT), name (UQ), label, description, is_final, sort_order. Seeds: 1 pending, 2 confirmed, 3 cancelled (final), 4 completed (final)
- **appointments**: id, property_id, client_id, status_id→appointment_status (default 1, RESTRICT), scheduled_at (30-min boundary check), notes (≤1000), timestamps
- **reservations**: id, property_id→properties (RESTRICT), client_id→users (RESTRICT), status `reservation_status` (default pending), notes (≤1000), confirmed_at, cancelled_at, completed_at, cancel_reason (≤255), created_at/updated_at. CHECKs: `status <> 'confirmed' OR confirmed_at IS NOT NULL`, `status <> 'cancelled' OR cancelled_at IS NOT NULL`, `status <> 'completed' OR completed_at IS NOT NULL`

3NF exception (keep documented): `addresses` city→province dependency (single-city scope). Rev 2's second exception (payment amount snapshot) no longer exists.

### Indexes and special constraints (raw SQL in migrations; TypeORM and DBML cannot express them)

- `users(email)` UNIQUE
- `properties(listing_type, status, price)`; `properties(type_id)`; `properties(agent_id)`; `addresses(barangay)`
- GIN on `to_tsvector(title || description)` (fallback ILIKE + pg_trgm)
- `property_images(property_id)` UNIQUE WHERE `is_primary`
- `appointments(property_id, scheduled_at)` UNIQUE WHERE `status_id IN (1, 2)` (ids are seeded, because index predicates cannot read another table)
- `appointment_status(name)` UNIQUE; `refresh_tokens(jti)` UNIQUE; `refresh_tokens(user_id)`
- `reservations(property_id)` UNIQUE WHERE `status = 'confirmed'` (one confirmed reservation per property)
- `reservations(client_id, property_id)` UNIQUE WHERE `status IN ('pending','confirmed')` (no duplicate active request)
- `reservations(client_id, created_at)`; `reservations(property_id, created_at)`
- `inquiries(property_id)`, `inquiries(client_id)`, `inquiry_messages(inquiry_id)`, `appointments(client_id)`
- The service never hard-codes status ids in queries. Expose `appointment_status` as a constant map name → id.

## API contract

Base path `/api`. Swagger at `/api/docs`. 55 endpoint-method combinations (Rev 2's 56 minus 5 payment routes plus 4 reservation routes).

### Conventions

- Success: `{ "success": true, "data": …, "meta": … }`
- Error: `{ "success": false, "error": { "statusCode", "code", "message", "details": [{field, message}], "path", "timestamp" } }`
- `error.details[].field` matches form input names (e.g. `address.city`).
- Pagination: `?page=1&limit=12`, limit ≤ 50. `meta: { page, limit, total, totalPages }`.
- Listing search `GET /properties`: `q, listingType, typeId, barangay, minPrice, maxPrice, bedrooms (min), bathrooms (min), amenityIds (comma list), status (default available), sort (newest|price_asc|price_desc)`.
- Status values are **strings** in requests/responses (`"pending"`), even for appointments stored by `status_id`. Unknown names → 400.
- Privacy: `GET /properties` and `/properties/:id` use `OptionalJwtAuthGuard`. With a valid token: `isFavorite` and agent phone. Without: `isFavorite: false`, no phone, agent name only.
- Declare static routes before param routes: `/properties/mine` before `/properties/:id`, `/users/me` before `/users/:id`.
- Addresses have no standalone routes. They are created/updated through the nested `address` object of the property routes.

### Routes

| Area         | Method + path                                                                                                                                                        | Access                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Auth         | POST `/auth/register` (always role client)                                                                                                                           | Public                                            |
|              | POST `/auth/login`                                                                                                                                                   | Public                                            |
|              | POST `/auth/refresh`                                                                                                                                                 | Public (valid refresh cookie)                     |
|              | POST `/auth/logout`, GET `/auth/me`                                                                                                                                  | Logged in                                         |
| Users        | GET `/users` (filter role, status, search), POST `/users` (create agent/admin), GET `/users/:id`, PATCH `/users/:id`, DELETE `/users/:id` (soft; not the last admin) | Admin                                             |
|              | GET `/users/me`, PATCH `/users/me`, PATCH `/users/me/password`                                                                                                       | Logged in                                         |
| Roles        | GET `/roles`                                                                                                                                                         | Admin                                             |
| Properties   | GET `/properties`, GET `/properties/:id` (include `reservationFee`, `canPayOnline`)                                                                                  | Public (optional JWT)                             |
|              | GET `/properties/mine`                                                                                                                                               | Agent                                             |
|              | POST `/properties` (agent: own; admin: must pass `agentId`)                                                                                                          | Agent, Admin                                      |
|              | PATCH `/properties/:id`, PATCH `/:id/status`, PUT `/:id/amenities`, DELETE `/:id` (soft)                                                                             | Agent (owner), Admin                              |
| Images       | POST `/properties/:id/images` (multipart), PATCH/DELETE `/properties/:id/images/:imageId`                                                                            | Agent (owner), Admin                              |
| Catalogs     | GET `/property-types`, `/amenities`, `/meta/barangays`, `/appointment-statuses`                                                                                      | Public                                            |
|              | POST/PATCH/DELETE `/property-types[/:id]`, `/amenities[/:id]` (delete blocked while in use)                                                                          | Admin                                             |
| Favorites    | GET `/favorites`, POST `/favorites` `{propertyId}` (idempotent), DELETE `/favorites/:propertyId`                                                                     | Client                                            |
| Inquiries    | POST `/properties/:id/inquiries`                                                                                                                                     | Client                                            |
|              | GET `/inquiries` (client own, agent own listings, admin all), GET `/inquiries/:id`, GET/POST `/inquiries/:id/messages`                                               | Involved client/agent, Admin                      |
|              | PATCH `/inquiries/:id` (read, closed; `replied` is automatic on first agent message)                                                                                 | Agent (owner), Admin                              |
|              | DELETE `/inquiries/:id`                                                                                                                                              | Admin                                             |
| Appointments | POST `/properties/:id/appointments` `{scheduledAt, notes}`                                                                                                           | Client                                            |
|              | GET `/appointments`, GET `/appointments/:id`                                                                                                                         | Involved, Admin                                   |
|              | PATCH `/appointments/:id` (client: reschedule/cancel own pending; agent: confirm/cancel/complete)                                                                    | Client (own), Agent (owner), Admin                |
|              | DELETE `/appointments/:id` (cleanup only)                                                                                                                            | Admin                                             |
| Reservations | POST `/properties/:id/reservations` `{notes?}` (property must be `available`)                                                                                        | Client                                            |
|              | GET `/reservations` (filters status, propertyId), GET `/reservations/:id`                                                                                            | Client own, Agent own listings, Admin             |
|              | PATCH `/reservations/:id` `{status, notes?, cancelReason?}` (transitions below)                                                                                      | Client (cancel own pending), Agent (owner), Admin |
| Admin        | GET `/admin/stats`                                                                                                                                                   | Admin                                             |

### Status codes and error codes

| Status    | Codes                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| 400       | VALIDATION_ERROR                                                                                                    |
| 401       | UNAUTHORIZED, INVALID_CREDENTIALS, TOKEN_EXPIRED, TOKEN_REVOKED                                                     |
| 403       | FORBIDDEN (wrong role or not owner)                                                                                 |
| 404       | NOT_FOUND (missing or soft-deleted)                                                                                 |
| 409       | CONFLICT, INVALID_STATUS_TRANSITION, RESERVATION_ALREADY_ACTIVE, PROPERTY_NOT_RESERVABLE, PROPERTY_ALREADY_RESERVED |
| 413 / 415 | PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE                                                                           |
| 429       | TOO_MANY_REQUESTS                                                                                                   |
| 500       | INTERNAL_ERROR (log with request id; never leak stack traces)                                                       |

Also 200, 201, 204 (deletes). Login errors use one generic message so the API never reveals whether an email exists.

## Authentication and authorization

- **Access token**: 15 min, claims `sub` and `role`, sent as `Authorization: Bearer`, kept in frontend memory.
- **Refresh token**: 7 days, separate signing secret, httpOnly + Secure + SameSite cookie scoped to `/api/auth`. Store only a row in `refresh_tokens` keyed by random `jti` (the token is never stored; nothing needs hashing).
- **Rotation on `/auth/refresh`**: verify signature/expiry → look up `jti` (missing or revoked → 401 `TOKEN_REVOKED`) → set `revoked_at` on old row → insert new row (`replaced_by_jti` chains) → set new cookie. Reuse of an already-rotated token is treated as theft: revoke all the user's active tokens. Logout revokes the row. Run rotation in a transaction.
- Suspended or deleted users are rejected at login **and** on refresh.
- Global `JwtAuthGuard` (deny by default), `@Public()` opt-out, `OptionalJwtAuthGuard` on the two public listing routes, `RolesGuard` reads `@Roles(...)`.
- Self-registration always creates `client`. Agents/admins are created by an admin (this is the agent-approval step).
- Frontend handling: on 401 `TOKEN_EXPIRED` call `/auth/refresh` once and retry; on `TOKEN_REVOKED` clear state and go to `/login`. Cookies need `credentials: "include"` and CORS allow-lists only the frontend origin. Cross-site needs `SameSite=None; Secure`; same parent domain allows `Lax`.

Permission matrix summary: guests browse and read catalogs; clients own favorites, inquiries, appointments, reservations; agents manage **own** listings/photos/amenities/fee, own inquiries, appointments, and reservations; admins can do anything above plus users, catalogs, stats.

## Status lifecycles (others return 409 `INVALID_STATUS_TRANSITION`)

| Field               | Allowed transitions                                                                                                                                                                                                                                                                           | Who                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| properties.status   | available → reserved/sold/rented; reserved → available/sold/rented                                                                                                                                                                                                                            | Agent (owner), Admin |
| inquiries.status    | new → read → replied → closed; new → replied/closed; read → closed                                                                                                                                                                                                                            | Agent (owner), Admin |
| appointments        | pending → confirmed (agent); pending → cancelled (client or agent); confirmed → cancelled/completed (agent). cancelled and completed are final (`is_final`)                                                                                                                                   | As listed            |
| reservations.status | pending → confirmed (agent/admin; property becomes `reserved`); pending → cancelled (client, agent, admin); confirmed → cancelled (agent/admin; property returns to `available`); confirmed → completed (agent/admin; property becomes `sold` or `rented`). cancelled and completed are final | As listed            |

Reservations and `properties.status` change together inside one transaction (see Reservations). While a property has a confirmed reservation, `PATCH /properties/:id/status` returns 409.

## Reservations (read before touching reservations)

BahayHub does not process payments. Any reservation fee is settled face to face between client and agent. The platform only records who wants to reserve a property and what the agent decided. Do **not** implement PayMongo, checkout, webhooks, idempotency keys, or `payment_logs`.

Reservations are not appointments. Appointments schedule property viewings. Reservations are a client's request to reserve a property. Keep the two separate.

1. **Create** (client only): the property must be `available` (else 409 `PROPERTY_NOT_RESERVABLE`). The client must not already have a pending or confirmed reservation for it (409 `RESERVATION_ALREADY_ACTIVE`, also enforced by the partial unique index). Several clients may hold pending reservations for the same property.
2. **Confirm** (agent owner or admin): in one transaction, lock the property row (`pessimistic_write`), require `properties.status = 'available'` (else 409 `PROPERTY_ALREADY_RESERVED`), set the reservation `confirmed` with `confirmed_at`, and set the property `reserved`. The partial unique index on confirmed reservations is the final guard against races.
3. **Cancel**: a client may cancel their own pending reservation. An agent or admin may cancel a pending or confirmed one. Set `cancelled_at` and optional `cancel_reason`. If the reservation was confirmed, set the property back to `available` in the same transaction.
4. **Complete** (agent owner or admin, from confirmed): set `completed` with `completed_at`. The property becomes `sold` if `listing_type = 'sale'`, or `rented` if `'rent'`; derive it, do not accept it from the request. Auto-cancel every other pending reservation for that property with `cancel_reason = 'Property no longer available'`.
5. **Manual property status**: `PATCH /properties/:id/status` returns 409 `CONFLICT` while the property has a confirmed reservation. The agent resolves it by cancelling or completing the reservation. An agent may still set a property to `reserved` manually, in which case later confirms return `PROPERTY_ALREADY_RESERVED`.
6. No delete route. Visibility: only the client, the listing's agent, and admins.
7. Wrap every transition in a TypeORM transaction. Never update `properties.status` outside the service method that owns the transition.
8. `admin/stats` returns reservations grouped by status.

Frontend contract changes from Rev 2: the "Pay reservation fee" button becomes "Reserve this property" (client, property `available`); `canPayOnline` is removed from `GET /properties/:id` (`reservationFee` stays as informational text); client dashboard gets "My reservations"; agent dashboard gets a reservation inbox with Confirm, Cancel, and Complete.

## Validation rules (DTOs and matching DB constraints)

| Field                            | Rule                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| email                            | valid, ≤150, lowercased, unique                                                                                           |
| password                         | 8–72 chars, ≥1 upper, ≥1 lower, ≥1 digit                                                                                  |
| firstName, lastName              | 1–60; letters, spaces, hyphens, periods, "ñ"                                                                              |
| phone                            | optional; `09XXXXXXXXX` or `+639XXXXXXXXX`                                                                                |
| title / description              | title 5–150; description ≤5000                                                                                            |
| price                            | >0, ≤2 decimals, max 999,999,999,999.99                                                                                   |
| reservationFee                   | optional, >0, ≤2 decimals, ≤ price; `null` means no fee stated (informational only)                                       |
| bedrooms, bathrooms              | integers 0–50                                                                                                             |
| floorAreaSqm, lotAreaSqm         | optional, >0                                                                                                              |
| address.city / province          | must be exactly "Butuan City" / "Agusan del Norte"                                                                        |
| address.barangay / street        | barangay required and in official Butuan list; street 3–255                                                               |
| inquiry message                  | first 10–2000; replies 1–2000                                                                                             |
| agentId (create listing)         | required only for Admin and must be an agent user; rejected for Agent callers                                             |
| scheduledAt                      | ISO 8601, future, within 60 days, 08:00–18:00 Manila, minutes 00/30, seconds 0, slot not already active for that property |
| appointment status               | a name from `/appointment-statuses`, transition allowed                                                                   |
| reservation notes / cancelReason | notes ≤1000; cancelReason ≤255 (optional)                                                                                 |
| reservation status (PATCH)       | one of pending, confirmed, cancelled, completed; only the transitions in the lifecycle table                              |
| query params                     | page ≥1, limit 1–50, minPrice ≤ maxPrice, unknown sort rejected                                                           |

## Security checklist for every change

- Parameterized queries only (TypeORM). No string-built SQL.
- Strip HTML tags from free-text fields (inquiry message, description).
- Mass assignment blocked by whitelist: clients cannot send `role`, `status`, `amount`, `agentId` (unless admin).
- Rate limits: 100 req/min/IP global; login 5/min per IP+email.
- Uploads: JPG/PNG/WebP only (check MIME **and** file signature), ≤5 MB, ≤15 photos per listing, stored in Cloudinary under generated names.
- Env vars (validated with Joi at startup, `.env` git-ignored, `.env.example` names only): `DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, CORS_ORIGIN, CLOUDINARY_*, NODE_ENV` (plus `PORT` if used). Secrets ≥256 bits, one per token type. No payment keys exist.
- HTTPS only, HSTS via Helmet, TLS to the database. CORS allow-list with credentials.
- Logging: method, path, status, user id, duration, plus reservation id and old/new status for each reservation transition. Never passwords, tokens, keys, or message bodies.

## Privacy and ethics (RA 10173)

- Registration shows a privacy notice and a required consent checkbox; the terms state that BahayHub does not process payments, does not hold funds, and that any reservation fee is settled in person between client and agent.
- Collect minimum data: no government IDs, birth dates, or financial details. Phone is optional and visible only to logged-in users.
- Deletion sets `deleted_at`, then anonymizes personal fields after the retention period (proposed 12 months). `reservations` rows stay (FK to the anonymized user) as history. Retention period is still to be confirmed with the adviser.
- No analytics or ad identifiers. No IP/user-agent in `refresh_tokens`; purge rows after `expires_at`.
- Breach response: revoke all refresh tokens, rotate JWT secrets, notify affected users and the NPC within 72 hours.
- Seed/test/screenshot data is fake only.
- Listing platform, not a broker (RA 9646): only admin-approved agents post. No online payments: BahayHub is not an escrow agent and holds no funds (say so in the terms).

## Testing expectations

- Jest unit tests for services with mocked repositories; Supertest e2e against a test database; Postman collection (runnable with Newman) for CRUD, auth, errors, and the reservation flow.
- Target: ≥70% statement coverage on services (including reservations) and a passing Postman collection before the Final demo.
- Minimum cases to cover when touching a module:
  - **Auth**: wrong password, expired/tampered token, rotation, reuse of rotated token (401 `TOKEN_REVOKED`), suspended user rejected.
  - **Authorization**: client cannot create listing (403); agent cannot edit another agent's listing (403); guest sees no phone/`isFavorite`; only admin lists users.
  - **Appointments**: each allowed transition succeeds and every other 409s; cancelled slot can be rebooked, pending/confirmed cannot (409); non-30-minute times 400.
  - **Reservations**: create on a non-available property 409; duplicate active reservation 409; two clients may both be pending; confirm sets the property `reserved`; confirming when another is confirmed or the property is manually reserved 409; client cancels own pending, cannot cancel another client's (403); cancelling a confirmed reservation returns the property to `available`; complete sets `sold` (sale) or `rented` (rent) and auto-cancels other pending ones; property status PATCH while a confirmed reservation exists 409; agent cannot touch reservations on another agent's listing (403); client sees only their own; two concurrent confirms leave exactly one confirmed (partial unique index).
  - **DB constraints**: amount ≤ 0, paid without `paid_at`, duplicate `provider_ref` all rejected.

## Seed data (fake only)

1 admin, 3 agents, 5 clients, ~20 Butuan listings with 3–5 photos (about half with `reservation_fee`, e.g. 5,000 sale / 2,000 rent), ~10 appointments across all four statuses (including one cancelled slot later rebooked), 5–6 `reservations` across all four statuses (at most one confirmed per property, matching the property's `reserved` status). Types: House and Lot, Condominium, Townhouse, Apartment, Vacant Lot, Commercial. Amenities: Parking, Wi-Fi Ready, Swimming Pool, 24/7 Security, Garden, Fully Furnished, Pet Friendly, Near School. Barangay list: use **all** official Butuan City barangays (examples: Libertad, Ampayon, Doongan, Baan Km. 3, Bancasi, Ambago, Langihan, Masao, Pianing, Agusan Pequeño).

## Working mode

One developer (the user) builds the whole backend with AI assistance. The partner reviews PRs and runs the Postman/Newman collection against the deployed API, and does not write backend code. Keep each task small (one module at a time) and finish it with its tests before moving on. When asked to plan, write the plan to `docs/PLAN.md`, never read the PDF in `/docs`, and do not explore the whole repo: read only `package.json` and the `src/` listing unless told otherwise.

## Delivery plan (from the doc, adjusted for a solo build starting Nov 26, 2026)

Bootstrap + empty Render deploy → migrations + seeds → auth/users → properties/images/catalogs → favorites/inquiries/appointments/stats → global validation/error filter → reservations → Swagger + Postman → frontend integration → final deploy and testing (target Dec 6). Deploy an empty API to Render **early** (day 1 or 2) to catch TLS, cookie, CORS, and env problems before the end, and create the Render and Cloudinary accounts on day 1. **Cut line**: check on the evening of Dec 1 (reservations start Dec 2). If auth, properties, and appointments are not finished and passing their tests by then, ship reservations as create + list + detail + confirm/cancel only, and drop the `completed` transition and the stats breakdown.

## Known inconsistencies in the Rev 2 documentation (do not propagate them)

- The original folder tree omitted `payments/`, misnamed `appointments-status/`, wrote `nestcli.json`, and dropped a slash in `favorites/ inquiries`. Use the corrected tree above.
- Figure 1 (use case diagram) still shows the original use cases. Add "Reserve property" (client) and "Manage reservations" (agent/admin) when regenerating, and do not add payment use cases.
- Every Rev 2 section about PayMongo, the webhook, `payment_logs`, payment tests, payment error codes, `PAYMENT_*` env vars, RA 8792, and the 56-endpoint count is superseded. Update the written report so it matches this file.
- The dbdiagram link in Appendix B points to the old 13-table diagram. Regenerate from the DBML in Appendix D and update the link.
- The DBML omits partial unique indexes and CHECK constraints by design. They live in migrations.

## When asked to produce code, default to

- A full module (`module`, `controller`, `service`, `entities/`, `dto/`) following the layer rules, with Swagger decorators on DTOs and controllers.
- Migrations as raw-SQL-capable TypeORM migration classes with `up` and `down`.
- DTOs that use class-validator rules from the table above, so DB constraints and API validation stay in step.
- Tests alongside the code (Jest for service logic, Supertest for the route).
