---
name: bahayhub-backend
description: Project rules, schema, API contract, and conventions for the BahayHub backend (NestJS + TypeORM + PostgreSQL real estate listing platform for Butuan City, ITE 18 midterm/final project, Rev 2). Use this skill whenever the user mentions BahayHub, the Butuan real estate API, ITE 18 backend work, or asks to write, review, or debug any NestJS module, TypeORM entity, migration, seed, DTO, guard, Swagger doc, Postman test, or documentation for properties, listings, inquiries, appointments, favorites, payments, webhooks, refresh tokens, or roles in this project. Also use it when updating the backend documentation, ERD/DBML, data dictionary, or frontend-backend API contract, even if the user does not say "BahayHub" explicitly.
---

# BahayHub Backend

Backend for **BahayHub**, a real estate listing and inquiry platform for **Butuan City, Agusan del Norte** only. Course: ITE 18 (Application Development and Emerging Technologies), Caraga State University. Team: Lugsanay (auth, users, favorites, inquiries, appointments, admin stats, deployment) and Magbanua (DB, migrations, properties, images, catalogs, payments, Swagger/Postman). The frontend is a separate TypeScript SPA built by the partner pair. **The API contract in this file is shared with them. Never change a route, field name, or error code without flagging it as a contract change.**

Status: Rev 2 design is the pre-development baseline. Source code is built for the Final (target Dec 6, 2026).

## How to use this skill

1. Before writing code, check the relevant section below (schema, API, auth, payments).
2. Generate code that matches these conventions exactly. If the user's request conflicts with the contract, say so before proceeding.
3. When you add or change a route, column, enum, or error code, list which docs must be updated (data dictionary, DBML, Swagger, Postman, frontend mapping table).
4. If something is not specified here, ask or state your assumption. Do not invent endpoints or columns silently.

## Stack (fixed by the course and the design)

| Concern | Choice |
|---|---|
| Framework | NestJS (Node.js 20 LTS, TypeScript), modular monolith |
| DB | PostgreSQL 15+ |
| ORM | TypeORM with versioned migrations. `synchronize` is **never** true outside throwaway local dev |
| Auth | JWT access (15 min) + rotating refresh token (7 days, httpOnly cookie) tracked in `refresh_tokens` |
| Validation | class-validator + class-transformer, global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) |
| Images | Cloudinary (never local disk) |
| Payments | PayMongo hosted checkout, **sandbox/test keys only** |
| Hosting | Render (web service + managed Postgres), deploys from `main` |
| Docs/tests | Swagger at `/api/docs`, Postman (+ Newman), Jest, Supertest |
| Security libs | Helmet, `@nestjs/throttler`, bcrypt (cost 12), cookie-parser |

## Architecture rules

Request pipeline: middleware (Helmet, CORS allow-list, throttler, cookie-parser, rawBody, logger) → guards (JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard, WebhookSignatureGuard) → ValidationPipe → controller → service → repository → PostgreSQL.

| Layer | Does | Must not |
|---|---|---|
| Controller | Route + method mapping, read DTOs, return result | Business rules, DB access |
| Service | Ownership checks, status transitions, double-booking check, bcrypt, token rotation, pagination, payable amount, gateway session, idempotent webhook | Touch `req`/`res` |
| Repository (TypeORM) | Only layer that talks to Postgres: queries, transactions | Decide who may do what |
| DTO/Entity | DTOs validate/shape I/O; entities map tables | Expose `password_hash` or internal columns |
| Guards/Pipes/Filters | Authn, role checks, validation, signature check, uniform errors | Hold feature logic |

- Guards check **role**; services check **ownership**.
- A global exception filter and response interceptor produce the response envelopes below.
- `main.ts` bootstraps with `rawBody: true` (needed for webhook HMAC).

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
│   ├── payments/                 # checkout creation, webhook, refunds, gateway client
│   ├── meta/                     # barangay list
│   ├── admin/                    # dashboard stats (incl. verified payment totals)
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

## Database (15 tables, 3NF with 2 documented exceptions)

Migration order: `roles → users → refresh_tokens → property_types → addresses → properties → property_images → amenities → property_amenities → favorites → inquiries → inquiry_messages → appointment_status → appointments → payment_logs`. Create `payment_status` and `payment_method` enums before `payment_logs`. Seed `appointment_status` in the same migration that creates it, with explicit ids 1–4, then reset the sequence.

### Conventions

- PKs: `bigint` identity (uuid for token `jti`). Junction tables use composite PKs.
- Money: `numeric(14,2)` (PHP). Area: `numeric(10,2)`. Add a column transformer so `price`, `reservation_fee`, `amount`, and areas return as **numbers** (pg returns numeric/bigint as strings).
- Time: `timestamptz` in UTC; frontend displays Asia/Manila.
- Soft delete (`@DeleteDateColumn`) on `users` and `properties` only. History tables use `ON DELETE RESTRICT`.
- `payment_logs` is an append-only audit log: never deleted; after creation only `status, method, paid_at, failure_reason, refunded_at, refund_note, updated_at` change.
- Load relations with explicit joins (avoid N+1). `password_hash` is `select: false`.

### Enums

`user_status` (active, inactive, suspended) · `listing_type` (sale, rent) · `property_status` (available, reserved, sold, rented) · `inquiry_status` (new, read, replied, closed) · `payment_status` (pending, paid, failed, cancelled, refunded) · `payment_method` (gcash, maya, card, bank_transfer, other). Appointment states are **not** an enum: they live in `appointment_status`.

### Tables (key columns)

- **roles**: id, name (UQ: admin/agent/client), description
- **users**: id, role_id→roles, first_name(60), last_name(60), email(150, UQ, lowercase), password_hash(255), phone(20, optional), status, created_at/updated_at, deleted_at
- **refresh_tokens**: id, user_id→users (CASCADE), jti uuid (UQ), expires_at, revoked_at, replaced_by_jti, created_at
- **property_types**: id, name(50, UQ)
- **addresses**: id, street(255), barangay(100; nullable in DB, required by API), city (default Butuan City), province (default Agusan del Norte), postal_code (default 8600), country (default Philippines)
- **properties**: id, agent_id→users, type_id→property_types, address_id→addresses (UQ, 1:1), title(150), description text, price (>0), **reservation_fee** (NULL or >0 and ≤ price), listing_type, status (default available), bedrooms/bathrooms (0–50), floor_area_sqm, lot_area_sqm (>0), timestamps, deleted_at
- **property_images**: id, property_id→properties (CASCADE), image_url(500), caption(150), is_primary, sort_order
- **amenities**: id, name(50, UQ), icon(50) · **property_amenities**: (property_id, amenity_id) composite PK, both CASCADE
- **favorites**: (user_id, property_id) composite PK, CASCADE, created_at
- **inquiries**: id, property_id, client_id, message (CHECK length 10–2000), status (default new), created_at (RESTRICT FKs)
- **inquiry_messages**: id, inquiry_id (CASCADE), sender_id (RESTRICT), message (1–2000), created_at
- **appointment_status**: id (GENERATED BY DEFAULT), name (UQ), label, description, is_final, sort_order. Seeds: 1 pending, 2 confirmed, 3 cancelled (final), 4 completed (final)
- **appointments**: id, property_id, client_id, status_id→appointment_status (default 1, RESTRICT), scheduled_at (30-min boundary check), notes (≤1000), timestamps
- **payment_logs**: id, client_id, property_id, appointment_id (nullable), amount (>0, snapshot of reservation_fee), currency (default PHP), status (default pending), method (nullable), provider (default paymongo), provider_ref (UQ, nullable until session created), idempotency_key uuid, checkout_url, failure_reason, paid_at, refunded_at, refund_note, timestamps. CHECK `status <> 'paid' OR paid_at IS NOT NULL`

3NF exceptions (keep documented): (1) `addresses` city→province dependency (single-city scope); (2) `payment_logs.amount` is a deliberate snapshot of the fee at payment time.

### Indexes and special constraints (raw SQL in migrations; TypeORM and DBML cannot express them)

- `users(email)` UNIQUE
- `properties(listing_type, status, price)`; `properties(type_id)`; `properties(agent_id)`; `addresses(barangay)`
- GIN on `to_tsvector(title || description)` (fallback ILIKE + pg_trgm)
- `property_images(property_id)` UNIQUE WHERE `is_primary`
- `appointments(property_id, scheduled_at)` UNIQUE WHERE `status_id IN (1, 2)` (ids are seeded, because index predicates cannot read another table)
- `appointment_status(name)` UNIQUE; `refresh_tokens(jti)` UNIQUE; `refresh_tokens(user_id)`
- `payment_logs(provider_ref)` UNIQUE; `(client_id, idempotency_key)` UNIQUE; `(client_id, property_id)` UNIQUE WHERE `status = 'pending'`; `(client_id, created_at)`; `(property_id, created_at)`
- `inquiries(property_id)`, `inquiries(client_id)`, `inquiry_messages(inquiry_id)`, `appointments(client_id)`
- The service never hard-codes status ids in queries. Expose `appointment_status` as a constant map name → id.

## API contract

Base path `/api`. Swagger at `/api/docs`. 56 endpoint-method combinations.

### Conventions

- Success: `{ "success": true, "data": …, "meta": … }`
- Error: `{ "success": false, "error": { "statusCode", "code", "message", "details": [{field, message}], "path", "timestamp" } }`
- `error.details[].field` matches form input names (e.g. `address.city`).
- Pagination: `?page=1&limit=12`, limit ≤ 50. `meta: { page, limit, total, totalPages }`.
- Listing search `GET /properties`: `q, listingType, typeId, barangay, minPrice, maxPrice, bedrooms (min), bathrooms (min), amenityIds (comma list), status (default available), sort (newest|price_asc|price_desc)`.
- Status values are **strings** in requests/responses (`"pending"`), even for appointments stored by `status_id`. Unknown names → 400.
- `POST /properties/:id/payments` accepts an `Idempotency-Key` header (UUID); same key from same user returns the original payment.
- Privacy: `GET /properties` and `/properties/:id` use `OptionalJwtAuthGuard`. With a valid token: `isFavorite` and agent phone. Without: `isFavorite: false`, no phone, agent name only.
- Declare static routes before param routes: `/properties/mine` before `/properties/:id`, `/users/me` before `/users/:id`, `/payments/webhook` before `/payments/:id`.
- Addresses have no standalone routes. They are created/updated through the nested `address` object of the property routes.

### Routes

| Area | Method + path | Access |
|---|---|---|
| Auth | POST `/auth/register` (always role client) | Public |
| | POST `/auth/login` | Public |
| | POST `/auth/refresh` | Public (valid refresh cookie) |
| | POST `/auth/logout`, GET `/auth/me` | Logged in |
| Users | GET `/users` (filter role, status, search), POST `/users` (create agent/admin), GET `/users/:id`, PATCH `/users/:id`, DELETE `/users/:id` (soft; not the last admin) | Admin |
| | GET `/users/me`, PATCH `/users/me`, PATCH `/users/me/password` | Logged in |
| Roles | GET `/roles` | Admin |
| Properties | GET `/properties`, GET `/properties/:id` (include `reservationFee`, `canPayOnline`) | Public (optional JWT) |
| | GET `/properties/mine` | Agent |
| | POST `/properties` (agent: own; admin: must pass `agentId`) | Agent, Admin |
| | PATCH `/properties/:id`, PATCH `/:id/status`, PUT `/:id/amenities`, DELETE `/:id` (soft) | Agent (owner), Admin |
| Images | POST `/properties/:id/images` (multipart), PATCH/DELETE `/properties/:id/images/:imageId` | Agent (owner), Admin |
| Catalogs | GET `/property-types`, `/amenities`, `/meta/barangays`, `/appointment-statuses` | Public |
| | POST/PATCH/DELETE `/property-types[/:id]`, `/amenities[/:id]` (delete blocked while in use) | Admin |
| Favorites | GET `/favorites`, POST `/favorites` `{propertyId}` (idempotent), DELETE `/favorites/:propertyId` | Client |
| Inquiries | POST `/properties/:id/inquiries` | Client |
| | GET `/inquiries` (client own, agent own listings, admin all), GET `/inquiries/:id`, GET/POST `/inquiries/:id/messages` | Involved client/agent, Admin |
| | PATCH `/inquiries/:id` (read, closed; `replied` is automatic on first agent message) | Agent (owner), Admin |
| | DELETE `/inquiries/:id` | Admin |
| Appointments | POST `/properties/:id/appointments` `{scheduledAt, notes}` | Client |
| | GET `/appointments`, GET `/appointments/:id` | Involved, Admin |
| | PATCH `/appointments/:id` (client: reschedule/cancel own pending; agent: confirm/cancel/complete) | Client (own), Agent (owner), Admin |
| | DELETE `/appointments/:id` (cleanup only) | Admin |
| Payments | POST `/properties/:id/payments` `{appointmentId?}` | Client |
| | GET `/payments` (filters status, propertyId), GET `/payments/:id` | Client own, Agent own listings, Admin |
| | PATCH `/payments/:id` `{status:"refunded", note?}` (paid → refunded only) | Admin |
| | POST `/payments/webhook` | Public, signature verified |
| Admin | GET `/admin/stats` | Admin |

### Status codes and error codes

| Status | Codes |
|---|---|
| 400 | VALIDATION_ERROR |
| 401 | UNAUTHORIZED, INVALID_CREDENTIALS, TOKEN_EXPIRED, TOKEN_REVOKED, INVALID_SIGNATURE |
| 403 | FORBIDDEN (wrong role or not owner) |
| 404 | NOT_FOUND (missing or soft-deleted) |
| 409 | CONFLICT, PAYMENT_ALREADY_PENDING, PROPERTY_NOT_PAYABLE, INVALID_STATUS_TRANSITION |
| 413 / 415 | PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE |
| 429 | TOO_MANY_REQUESTS |
| 500 | INTERNAL_ERROR (log with request id; never leak stack traces) |
| 502 | PAYMENT_GATEWAY_ERROR (mark pending row `failed`) |

Also 200, 201, 204 (deletes). Login errors use one generic message so the API never reveals whether an email exists.

## Authentication and authorization

- **Access token**: 15 min, claims `sub` and `role`, sent as `Authorization: Bearer`, kept in frontend memory.
- **Refresh token**: 7 days, separate signing secret, httpOnly + Secure + SameSite cookie scoped to `/api/auth`. Store only a row in `refresh_tokens` keyed by random `jti` (the token is never stored; nothing needs hashing).
- **Rotation on `/auth/refresh`**: verify signature/expiry → look up `jti` (missing or revoked → 401 `TOKEN_REVOKED`) → set `revoked_at` on old row → insert new row (`replaced_by_jti` chains) → set new cookie. Reuse of an already-rotated token is treated as theft: revoke all the user's active tokens. Logout revokes the row. Run rotation in a transaction.
- Suspended or deleted users are rejected at login **and** on refresh.
- Global `JwtAuthGuard` (deny by default), `@Public()` opt-out, `OptionalJwtAuthGuard` on the two public listing routes, `RolesGuard` reads `@Roles(...)`.
- Self-registration always creates `client`. Agents/admins are created by an admin (this is the agent-approval step).
- Frontend handling: on 401 `TOKEN_EXPIRED` call `/auth/refresh` once and retry; on `TOKEN_REVOKED` clear state and go to `/login`. Cookies need `credentials: "include"` and CORS allow-lists only the frontend origin. Cross-site needs `SameSite=None; Secure`; same parent domain allows `Lax`.

Permission matrix summary: guests browse and read catalogs; clients own favorites, inquiries, appointments, payments; agents manage **own** listings/photos/amenities/fee, own inquiries and appointments, and see payments on own listings; admins can do anything above plus users, catalogs, refunds, stats.

## Status lifecycles (others return 409 `INVALID_STATUS_TRANSITION`)

| Field | Allowed transitions | Who |
|---|---|---|
| properties.status | available → reserved/sold/rented; reserved → available/sold/rented | Agent (owner), Admin |
| inquiries.status | new → read → replied → closed; new → replied/closed; read → closed | Agent (owner), Admin |
| appointments | pending → confirmed (agent); pending → cancelled (client or agent); confirmed → cancelled/completed (agent). cancelled and completed are final (`is_final`) | As listed |
| payment_logs.status | pending → paid/failed/cancelled (webhook or lazy expiry); paid → refunded (admin). failed, cancelled, refunded are final. A new attempt creates a new row | Webhook, Admin |

A paid fee does **not** auto-change listing status. The owning agent sets `reserved` (avoids a race between two paying clients).

## Payments (read before touching anything payment-related)

1. Client calls `POST /properties/:id/payments`. Service checks role, listing is `available` and has `reservation_fee` (else 409 `PROPERTY_NOT_PAYABLE`), and no open payment (else 409 `PAYMENT_ALREADY_PENDING`).
2. **Lazy expiry first**: any of that client's pending rows for the listing older than 30 minutes become `cancelled`. No background job (free-tier servers sleep).
3. Insert pending `payment_logs` row; amount is **read server-side from the listing**, never from the request body. A body containing `amount` is rejected (400 via forbidNonWhitelisted).
4. Create the gateway checkout session; store `provider_ref` and `checkout_url`; return `checkoutUrl`. Gateway failure → mark row `failed`, return 502.
5. Browser pays on the hosted page. The **webhook, not the redirect, is the source of truth**. The frontend always reads status from `GET /payments/:id`.
6. Webhook handler: verify HMAC over the **raw body** with timing-safe comparison; reject events older than 5 minutes (401 `INVALID_SIGNATURE`); find row by `provider_ref`; unknown ref → acknowledge without error; repeated event changes nothing (idempotent); compare gateway amount to stored amount and mark `failed` + log alert on mismatch; otherwise set `paid` + `paid_at` + `method`. Discard the payload, keep only dictionary fields.
7. Refund: admin only, `paid → refunded`, optional note ≤ 255. The platform does not move money; the admin records it after handling it in the gateway dashboard.

Never store card or wallet details, payer name, phone, or address. Never log secrets, signatures, or gateway payloads. Test keys only until the Final. The platform is **not** an escrow agent (state this in terms and docs).

## Validation rules (DTOs and matching DB constraints)

| Field | Rule |
|---|---|
| email | valid, ≤150, lowercased, unique |
| password | 8–72 chars, ≥1 upper, ≥1 lower, ≥1 digit |
| firstName, lastName | 1–60; letters, spaces, hyphens, periods, "ñ" |
| phone | optional; `09XXXXXXXXX` or `+639XXXXXXXXX` |
| title / description | title 5–150; description ≤5000 |
| price | >0, ≤2 decimals, max 999,999,999,999.99 |
| reservationFee | optional, >0, ≤2 decimals, ≤ price; `null` disables online payment |
| bedrooms, bathrooms | integers 0–50 |
| floorAreaSqm, lotAreaSqm | optional, >0 |
| address.city / province | must be exactly "Butuan City" / "Agusan del Norte" |
| address.barangay / street | barangay required and in official Butuan list; street 3–255 |
| inquiry message | first 10–2000; replies 1–2000 |
| agentId (create listing) | required only for Admin and must be an agent user; rejected for Agent callers |
| scheduledAt | ISO 8601, future, within 60 days, 08:00–18:00 Manila, minutes 00/30, seconds 0, slot not already active for that property |
| appointment status | a name from `/appointment-statuses`, transition allowed |
| payment appointmentId | optional; caller's own, same listing, pending or confirmed |
| payment PATCH status | only `refunded`, only from `paid` |
| query params | page ≥1, limit 1–50, minPrice ≤ maxPrice, unknown sort rejected |

## Security checklist for every change

- Parameterized queries only (TypeORM). No string-built SQL.
- Strip HTML tags from free-text fields (inquiry message, description).
- Mass assignment blocked by whitelist: clients cannot send `role`, `status`, `amount`, `agentId` (unless admin).
- Rate limits: 100 req/min/IP global; login 5/min per IP+email; payment start 10/min per user; webhook has its own higher limit.
- Uploads: JPG/PNG/WebP only (check MIME **and** file signature), ≤5 MB, ≤15 photos per listing, stored in Cloudinary under generated names.
- Env vars (validated with Joi at startup, `.env` git-ignored, `.env.example` names only): `DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, CORS_ORIGIN, CLOUDINARY_*, PAYMENT_SECRET_KEY, PAYMENT_WEBHOOK_SECRET, PAYMENT_SUCCESS_URL, PAYMENT_CANCEL_URL, NODE_ENV`. Secrets ≥256 bits, one per token type. Payment secret never goes to the frontend.
- HTTPS only, HSTS via Helmet, TLS to the database. CORS allow-list with credentials.
- Logging: method, path, status, user id, duration, plus payment id and old/new status for each payment transition. Never passwords, tokens, signatures, keys, gateway payloads, or message bodies.

## Privacy and ethics (RA 10173)

- Registration shows a privacy notice and a required consent checkbox; terms name the payment gateway as third-party processor.
- Collect minimum data: no government IDs, birth dates, or financial details. Phone is optional and visible only to logged-in users.
- Deletion sets `deleted_at`, then anonymizes personal fields after the retention period (proposed 12 months). `payment_logs` rows stay (FK to anonymized user). Retention for financial records is still to be confirmed with the adviser.
- No analytics or ad identifiers. No IP/user-agent in `refresh_tokens`; purge rows after `expires_at`.
- Breach response: revoke all refresh tokens, rotate gateway/webhook secrets, notify affected users and the NPC within 72 hours.
- Seed/test/screenshot data is fake only. Payments in demos use test mode.
- Listing platform, not a broker (RA 9646): only admin-approved agents post. Online payments touch RA 8792.

## Testing expectations

- Jest unit tests for services with mocked repositories and a mocked gateway client; Supertest e2e against a test database; Postman collection (runnable with Newman) for CRUD, auth, errors, webhook replay using sandbox keys.
- Target: ≥70% statement coverage on services (including payments) and a passing Postman collection before the Final demo.
- Minimum cases to cover when touching a module:
  - **Auth**: wrong password, expired/tampered token, rotation, reuse of rotated token (401 `TOKEN_REVOKED`), suspended user rejected.
  - **Authorization**: client cannot create listing (403); agent cannot edit another agent's listing (403); guest sees no phone/`isFavorite`; only admin lists users.
  - **Appointments**: each allowed transition succeeds and every other 409s; cancelled slot can be rebooked, pending/confirmed cannot (409); non-30-minute times 400.
  - **Payments**: no-fee listing 409; second open payment 409; same idempotency key returns same row; `amount` in body 400; guest 401, agent 403.
  - **Webhook**: valid signature marks paid; bad/old signature 401; replay changes nothing; amount mismatch marks failed; unknown `provider_ref` acknowledged.
  - **DB constraints**: amount ≤ 0, paid without `paid_at`, duplicate `provider_ref` all rejected.
  - **Lazy expiry**: pending older than 30 min is cancelled on a new attempt.

## Seed data (fake only)

1 admin, 3 agents, 5 clients, ~20 Butuan listings with 3–5 photos (about half with `reservation_fee`, e.g. 5,000 sale / 2,000 rent), ~10 appointments across all four statuses (including one cancelled slot later rebooked), 5–6 sandbox `payment_logs` (two paid, one pending, one failed, one cancelled, one refunded). Types: House and Lot, Condominium, Townhouse, Apartment, Vacant Lot, Commercial. Amenities: Parking, Wi-Fi Ready, Swimming Pool, 24/7 Security, Garden, Fully Furnished, Pet Friendly, Near School. Barangay list: use **all** official Butuan City barangays (examples: Libertad, Ampayon, Doongan, Baan Km. 3, Bancasi, Ambago, Langihan, Masao, Pianing, Agusan Pequeño).

## Delivery plan (from the doc; dates already slipping as of Nov 25, 2026)

Setup + empty Render deploy (Lugsanay) → migrations + seeds (Magbanua) → auth/users → properties/images/catalogs → favorites/inquiries/appointments/stats → global validation/error filter → payments → Swagger + Postman → frontend integration → final deploy and testing (target Dec 6). **Cut line**: if auth, properties, and appointments are not finished by Dec 2, reduce payments to the `payment_logs` table, the three read endpoints, and a seeded sandbox sample; document the webhook as designed but not deployed.

## Known inconsistencies in the Rev 2 documentation (do not propagate them)

- The original folder tree omitted `payments/`, misnamed `appointments-status/`, wrote `nestcli.json`, and dropped a slash in `favorites/ inquiries`. Use the corrected tree above.
- Figure 1 (use case diagram) still shows only the original use cases. Add "Pay reservation fee" (client) and "View payments" / "Record refund" (agent/admin) when regenerating.
- The dbdiagram link in Appendix B points to the old 13-table diagram. Regenerate from the DBML in Appendix D and update the link.
- The DBML omits partial unique indexes and CHECK constraints by design. They live in migrations.
- Payment sample responses are dated December 2026 while other samples are October 2026. Cosmetic only.

## When asked to produce code, default to

- A full module (`module`, `controller`, `service`, `entities/`, `dto/`) following the layer rules, with Swagger decorators on DTOs and controllers.
- Migrations as raw-SQL-capable TypeORM migration classes with `up` and `down`.
- DTOs that use class-validator rules from the table above, so DB constraints and API validation stay in step.
- Tests alongside the code (Jest for service logic, Supertest for the route).
