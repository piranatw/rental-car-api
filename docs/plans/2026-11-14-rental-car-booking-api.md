# Rental Car Booking API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Project #7 Rental Car Booking REST API from scratch in this directory, with promo codes, admin audit log, login brute-force protection, support tickets, return inspection with disputes, and a statistics report, proven by a Newman-runnable Postman collection.

**Architecture:** A new Express app with the layered layout `config`, `models`, `controllers`, `routes`, `middleware`, `server.js`, written fresh in this directory with no code, config, database or credentials taken from any other project. Each capability is one model, controller and route file mounted under `/api/v1`. Behaviour is verified only through HTTP, by a Postman collection run with Newman against a MongoDB the user provisions (see "Thing left for user").

**Tech Stack:** Node 22+ (the machine has 24), Express 4, Mongoose 8, MongoDB (user-provisioned: a fresh Atlas cluster or a fresh local `mongod`), jsonwebtoken, bcryptjs, `express-rate-limit`, Postman collection + Newman.

**Spec:** `spec.md` (this directory). No other project is a source: do not read, copy from or connect to any neighbouring repo, database or `.env` file.

## Thing left for user

The agent writes code and the Postman collection. It cannot create accounts, install software, or choose secrets for you. Do these before running Task 1's `npm test`. Everything is fresh: nothing reuses an existing database, cluster, `.env`, collection or credential.

### 1. Provision a fresh MongoDB (pick one)

**Option A, new Atlas cluster (matches the course wording):**
1. Sign in at cloud.mongodb.com and create a **new project** named `rental-car-api` (not an existing one).
2. In that project, create a **new free (M0) cluster**; choose any nearby region.
3. Under Database Access, add a **new database user** with a newly generated password (store it in a password manager, never in the repo).
4. Under Network Access, add your current IP address. Do not use `0.0.0.0/0`.
5. Click Connect, then Drivers, and copy the connection string. Edit it so the database name is the path: `.../rental_car_api?...` for development and a **second string ending `/rental_car_api_test?...`** for tests.

**Option B, a new local `mongod` on its own port and data directory.** This machine already runs a `mongod` on 27017 (Homebrew) and another on 55434 for an unrelated project. Do not use either. Start a separate one:
```bash
mkdir -p ~/rental-car-mongo/data
mongod --dbpath ~/rental-car-mongo/data --port 27555 --bind_ip 127.0.0.1
```
Leave it running in its own terminal. Your strings are then `mongodb://127.0.0.1:27555/rental_car_api` and `mongodb://127.0.0.1:27555/rental_car_api_test`. Atomic promo redemption and the audit log use single-document updates only, so a standalone `mongod` is enough (no replica set needed).

### 2. Create the environment file

In the project root create `config/config.env` (gitignored) with values you choose:
```
NODE_ENV=development
PORT=5050
MONGO_URI=<your development string>
JWT_SECRET=<a new random value, e.g. output of: openssl rand -hex 32>
JWT_EXPIRE=30d
JWT_COOKIE_EXPIRE=30
SEED_ADMIN_EMAIL=<an email you choose>
SEED_ADMIN_PASSWORD=<a password you choose, 8+ characters>
LOGIN_LOCK_MINUTES=15
LOGIN_MAX_ATTEMPTS=5
```
For tests, export the test string in your shell instead of the file: `export MONGO_URI="<your _test string>"`. `npm test` refuses to run unless the database name ends in `_test`, so it cannot wipe your dev data.

### 3. Install Postman and Newman

1. Install the Postman desktop app from postman.com (free account is enough). Used only to present and explore; the graded runs use Newman.
2. Newman is installed per-project by `npm install` (it is a devDependency); no global install is needed. Check with `npx newman --version`.
3. In Postman, import `__tests__/rental.postman_collection.json` and `__tests__/rental.postman_environment.json` once they exist, and set `adminEmail` and `adminPassword` in the environment to the same values as `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`.

### 4. GitHub repository (the slide requires a link)

1. Create a **new empty repository** on GitHub, for example `rental-car-api`, and invite your teammate as a collaborator.
2. After the agent's first commit, connect it: `git remote add origin <repo url>` then `git push -u origin main`.
3. Both students commit their own work so the history shows individual contribution (the slide grades by contribution).

### 5. Items only you can decide or provide

- Your teammate's name and student ID for `docs/work-division.md` (Task 12).
- What the lecturer means by Extra Credit, and whether it is separate from requirements A to F.
- Whether admins should be exempt from the 3-booking limit (the plan says yes).
- The Extra Credit VDO: record and upload it, then put the link in `README.md`.
- Optional: a hosted deployment (for example Render) if the lecturer wants a live URL; the plan only needs a local run.

## Global Constraints

- Web API only, REST, backend only, no frontend.
- Database is MongoDB Atlas or PostgreSQL; this plan uses MongoDB. The connection string comes only from the `MONGO_URI` environment variable; there is no default and no fallback, and the app exits with an error when it is unset. The database name is `rental_car_api` (tests: `rental_car_api_test`), and no task ever touches a database that already holds data.
- Authenticate with email + password; users reach only their own data, admins reach all.
- Every request responds within 3 seconds.
- Usable and testable via Postman; the collection must run unattended in Postman Runner or Newman.
- A registered user books at most 3 cars (spec Story 12). The spec is silent on admins, so admins are exempt from the limit (a decision for the user to overrule).
- Promo redemption increment is atomic (single conditional update).
- Login: lock 15 minutes after 5 consecutive failures; 10 login requests per minute per IP, HTTP 429 with a retry-after time; counter resets on success; wrong password and unknown email return the same generic error.
- Audit entries are immutable: no API updates or deletes them.
- Dispute: one comment per inspection, within 7 days.
- Late fee: overdue time rounded up to whole hours times the provider's `lateFeePerHour`.
- Stats and audit page respond within 3 seconds; stats aggregated in the database; non-admin gets HTTP 403.
- Never commit secrets: `config/config.env` is gitignored; commit `config/config.env.example`.
- Student ID and name on coursework: Piranat Wadlom, 6732031621.

## Review Focus

- **Zero-price booking and zero-fee provider:** a promo applied to a booking whose `totalPrice` is 0 (provider `dailyRate` 0) returns a specific 400, and an inspection for a provider with `lateFeePerHour` 0 returns `lateFee` 0 rather than NaN (Tasks 5 and 8 own this).
- **Concurrent promo redemption at the limit:** N parallel applies on a code with `maxRedemptions = 1` produce exactly one 200 and the rest a specific "exhausted" error, with `redemptionCount` equal to 1 (Task 5).
- **Admin edit that changes nothing or sends junk fields:** an audit `edit` entry records only fields that actually changed, and fields outside the booking schema are ignored, not stored or logged (Task 6).
- **Malformed ids and other people's ids:** a non-ObjectId ticket or booking id returns 404, not 500, and another user's ticket, inspection or dispute returns 403 without leaking content (Tasks 7, 8, 9).
- **Date edges:** a range where `to` is before `from`, a missing range, an inspection exactly 7 days after creation, and a return exactly on the scheduled time (zero fee) behave as the spec states (Tasks 6, 9, 10).

## File Structure

```
server.js                 app wiring, route mounting, seed users + providers, 404/error handler
config/db.js              connectDB()
config/config.env.example env template (real config.env gitignored)
middleware/auth.js        protect (+ token denylist check), authorize
middleware/loginLimiter.js IP rate limit for login, 429 + Retry-After
models/User.js            + failedLoginAttempts, lockUntil
models/Provider.js        name, address, tel, lateFeePerHour, dailyRate
models/Booking.js         user, provider, date, returnDate, totalPrice, promo, discount
models/RevokedToken.js    token hash, expiresAt (TTL index)
models/PromoCode.js       code, type, value, validity, maxRedemptions, redemptionCount, perUserLimit
models/PromoRedemption.js promo, user, booking
models/AuditLog.js        append-only, no update hooks exposed
models/Ticket.js          embedded comments
models/Inspection.js      embedded dispute
controllers/{auth,providers,bookings,promos,audit,tickets,inspections,stats}.js
routes/{auth,providers,bookings,promos,audit,tickets,inspections,stats}.js
__tests__/rental.postman_collection.json   Newman suite (one folder per task)
__tests__/rental.postman_environment.json  baseUrl, tokens
scripts/run-newman.sh     start mongod-backed server, run Newman, stop
docs/                     Requirements, Use Cases, Sequence, UML Profile (Task 12)
```

Task order: 1 → 2 → 3 are the foundation. Tasks 4–10 each depend only on Task 3 plus the interfaces noted, and can run in parallel after Task 3 except where a task's **Consumes** names another. Task 11 (Postman suite wiring) and 12 (documents) run last.

---

### Task 1: Project scaffold and authentication

**Files:**
- Create: `package.json`, `.gitignore`, `config/db.js`, `config/config.env.example`, `server.js`, `middleware/auth.js`, `models/User.js`, `controllers/auth.js`, `routes/auth.js`, `scripts/run-newman.sh`, `__tests__/rental.postman_collection.json`, `__tests__/rental.postman_environment.json`
- Test: `__tests__/rental.postman_collection.json` (folder `Auth`)

**Interfaces:**
- Consumes: nothing; this is the first task.
- Produces:
  - `protect(req,res,next)` sets `req.user` (Mongoose doc with `id`, `role`).
  - `authorize(...roles)` returns 403 for other roles.
  - `User` model with `email` unique, `role` in `['user','admin']`, `telephone` required, `password` `select:false`.
  - `POST /api/v1/auth/register|login`, `GET /api/v1/auth/me`.
  - `scripts/run-newman.sh` exits non-zero if any Newman assertion fails.
  - Env vars `MONGO_URI, JWT_SECRET, JWT_EXPIRE, JWT_COOKIE_EXPIRE, PORT`.

- [ ] **Step 1: `git init` here, create `.gitignore` (`node_modules/`, `config/config.env`, `.env`, `newman-report*`) and `package.json` (name `rental-car-api`) with scripts `start`, `dev`, `test` (`bash scripts/run-newman.sh`).** Dependencies: `express@4`, `mongoose@8`, `jsonwebtoken`, `bcryptjs`, `cookie-parser`, `cors`, `dotenv`, `express-rate-limit`; devDependencies `nodemon`, `newman`. Install with `npm install` and commit the lockfile.
- [ ] **Step 2: Write the failing `Auth` folder in the collection.** Requests and assertions:
  - `register ok` → 201 and body has `token` and no `password`.
  - `register duplicate email` → 400.
  - `register missing telephone` → 400.
  - `login ok` → 200 and sets env `userToken`.
  - Admin token: a collection-level pre-step logs in with the environment variables `adminEmail` and `adminPassword` (the same values the user puts in `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`) and sets `adminToken`; every later folder that needs an admin uses `{{adminToken}}`.
  - `me with token` → 200, `data.email` equals the registered email.
  - `me without token` → 401.
- [ ] **Step 3: Run `npm test`; expect failure (server missing).**
- [ ] **Step 4: Implement the files in Produces, written fresh.** `config/db.js` exports `connectDB()`, which throws `MONGO_URI is not set` when the variable is missing. `User { name, telephone (required), email (unique, validated), password (select:false, min 6, bcrypt-hashed in a pre-save hook), role ('user'|'admin', default 'user'), createdAt }`. Register always creates `role: 'user'` and ignores a client-supplied role. `protect` reads `Authorization: Bearer <jwt>`, `authorize` returns 403 with the role in the message. `server.js` loads `config/config.env`, mounts `/api/v1/auth`, and seeds one admin and one regular user only when `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` are set (the user chooses them; the plan hardcodes no credentials). `scripts/run-newman.sh` requires `MONGO_URI` to be set, refuses to run unless the database name in it ends in `_test`, starts the server on `PORT` (default 5050), waits for the port, runs Newman, kills the server, and propagates Newman's exit code.
- [ ] **Step 5: Run `npm test`; expect all `Auth` assertions green.**
- [ ] **Step 6: Commit** `feat: scaffold API with register, login and me`.

### Task 2: Logout with server-side token revocation

**Review:** per-task — authentication

**Files:**
- Create: `models/RevokedToken.js`
- Modify: `middleware/auth.js`, `controllers/auth.js`, `routes/auth.js`
- Test: collection folder `Auth` (additions)

**Interfaces:**
- Consumes: Task 1 `protect`.
- Produces: `POST /api/v1/auth/logout` (protected, 200). `protect` rejects a revoked token with 401. `RevokedToken { tokenHash: String (sha256, unique), expiresAt: Date }` with a TTL index on `expiresAt` so rows disappear when the JWT would have expired anyway.

- [ ] **Step 1: Add failing requests:** `logout` → 200; then `me with the same token` → 401; then `login again` → 200 and a new token works.
- [ ] **Step 2: Run `npm test`; expect the post-logout `me` to fail (returns 200).**
- [ ] **Step 3: Implement `logout`.** Hash the bearer token with sha256, store with `expiresAt` from the decoded `exp`. In `protect`, look up the hash after `jwt.verify` and return the same 401 body used for invalid tokens.
- [ ] **Step 4: Run `npm test`; expect green.**
- [ ] **Step 5: Commit** `feat: logout revokes token`.

### Task 3: Providers and bookings (base requirements)

**Files:**
- Create: `models/Provider.js`, `models/Booking.js`, `controllers/providers.js`, `controllers/bookings.js`, `routes/providers.js`, `routes/bookings.js`
- Modify: `server.js` (mount routes; seed providers)
- Test: collection folder `Bookings`

**Interfaces:**
- Consumes: Task 1 `protect`, `authorize`.
- Produces:
  - `Provider { name, address, tel, lateFeePerHour: Number >= 0 default 0, dailyRate: Number >= 0 default 0 }`.
  - `Booking { user, provider, date: Date, returnDate: Date (required, >= date), totalPrice: Number (computed, see below), promo: ObjectId|null, discount: Number default 0 }`.
  - Routes: `GET /api/v1/providers`, `GET /api/v1/providers/:id` (public); `POST|PUT|DELETE` providers admin only; `POST /api/v1/providers/:providerId/bookings`, `GET /api/v1/bookings`, `GET|PUT|DELETE /api/v1/bookings/:id`.
  - Controller helper `loadOwnedBooking(req,res)` returns the booking or sends the 404/403 response and returns `null`; later tasks reuse it.

- [ ] **Step 1: Write failing `Bookings` assertions:**
  - `list providers` → 200, each item has `name,address,tel`.
  - `create booking` → 201, `data.totalPrice` equals `dailyRate × whole days` (seed provider `dailyRate: 1000`, 2-day booking gives 2000).
  - `fourth booking` → 400 for a regular user after 3 exist.
  - `user lists own` → only own bookings.
  - `user gets other's booking` → 403.
  - `user edits own date` → 200 and total recomputed.
  - `user deletes own` → 200.
  - `admin views, edits and deletes any booking` → 200 each.
  - `no token` → 401.
  - `returnDate before date` → 400.
  - `malformed id` → 404, not 500.
- [ ] **Step 2: Run `npm test`; expect the `Bookings` folder to fail.**
- [ ] **Step 3: Implement models, controllers and routes, written fresh.** Rules: a non-owner gets 403; a malformed ObjectId returns 404 via a `CastError` check; `subtotal = dailyRate × max(1, ceil((returnDate - date) / 86400000))`, stored as `totalPrice` (with `discount` 0) at create and recomputed on `PUT` when `date`, `returnDate` or `provider` change. Task 5 later extends the recompute so a booking with a promo re-derives `discount` from `computeDiscount` and stores `totalPrice = subtotal - discount`.
- [ ] **Step 4: Seed two providers in `server.js` only when the providers collection is empty:** `{ name: 'Alpha Rentals', address: '1 Test Road', tel: '020000001', lateFeePerHour: 200, dailyRate: 1000 }` and `{ name: 'Beta Cars', address: '2 Test Road', tel: '020000002', lateFeePerHour: 500, dailyRate: 2500 }`.
- [ ] **Step 5: Run `npm test`; expect green.**
- [ ] **Step 6: Commit** `feat: providers and bookings with 3-booking limit`.

### Task 4: Login brute-force protection

**Review:** per-task — authentication

**Files:**
- Create: `middleware/loginLimiter.js`
- Modify: `models/User.js` (`failedLoginAttempts: Number default 0`, `lockUntil: Date`), `controllers/auth.js`, `routes/auth.js`
- Test: collection folder `LoginProtection`

**Interfaces:**
- Consumes: Task 1 `User`, `login`.
- Produces:
  - `loginLimiter` middleware: 10 requests per 60 s per IP; over the limit responds 429 with header `Retry-After` (seconds) and JSON `{ success:false, message, retryAfter }`.
  - Env `LOGIN_LOCK_MINUTES` (default 15) and `LOGIN_MAX_ATTEMPTS` (default 5).
  - Locked login returns 423 with `{ success:false, message, retryAfter }`; wrong password and unknown email both return 401 `{ success:false, message:'Invalid credentials' }` with identical bodies.

- [ ] **Step 1: Write failing assertions, using throwaway users created inside the folder:**
  - `wrong password` and `unknown email` → both 401 with `pm.expect(bodyA).to.eql(bodyB)`.
  - 5 wrong passwords → 6th request with the correct password → 423 and `retryAfter` > 0.
  - A success after 3 failures resets: 3 fails, 1 success, 4 fails → still 401, not 423.
  - A separate folder step fires 11 logins in a row (collection-level loop via `postman.setNextRequest`) → the 11th returns 429 with a `Retry-After` header.
  - Because the IP limit would affect later folders, the rate limiter is skipped when `NODE_ENV=test` unless `RATE_LIMIT_FORCE=1`; `run-newman.sh` runs the whole collection with the limiter skipped, then runs the `LoginProtection` 429 request alone with `RATE_LIMIT_FORCE=1` on a restarted server.
- [ ] **Step 2: Run; expect failures.**
- [ ] **Step 3: Implement.** Use `express-rate-limit` with `windowMs: 60_000`, `limit: 10`, custom handler; in `login`, on user found and password wrong increment `failedLoginAttempts` with an atomic `$inc` and set `lockUntil` when it reaches the max; check `lockUntil > now` before comparing the password; on success `$set` attempts `0` and unset `lockUntil`. Unknown email runs a dummy `bcrypt.compare` so timing matches.
- [ ] **Step 4: Run; expect green.**
- [ ] **Step 5: Commit** `feat: login lockout, IP rate limit, generic errors`.

### Task 5: Promotion codes

**Review:** per-task — concurrency

**Files:**
- Create: `models/PromoCode.js`, `models/PromoRedemption.js`, `controllers/promos.js`, `routes/promos.js`
- Modify: `server.js`, `controllers/bookings.js` (recompute discount on date edit)
- Test: collection folder `Promos`

**Interfaces:**
- Consumes: Task 3 `Booking`, `loadOwnedBooking`.
- Produces:
  - `PromoCode { code (unique, upper-cased), type: 'percentage'|'fixed', value: Number > 0, validFrom, validTo, maxRedemptions: Number >= 1, redemptionCount: Number default 0, perUserLimit: Number >= 1 optional }`.
  - `PromoRedemption { promo, user, booking }`.
  - `POST /api/v1/promos` (admin), `GET /api/v1/promos` (admin), `POST /api/v1/bookings/:id/promo` body `{ code }` (owner).
  - `computeDiscount(promo, subtotal) → number` (percentage: `subtotal × value / 100`; fixed: `value`; never more than `subtotal`).
  - Error messages, exact: `Promo code not found`, `Promo code is not yet valid`, `Promo code has expired`, `Promo code has reached its maximum redemptions`, `You have reached the per-user limit for this promo code`, `Booking already has a promo code`.

- [ ] **Step 1: Write failing assertions:**
  - Admin creates `SAVE10` (percentage 10) → 201; percentage 150 → 400; `validTo` before `validFrom` → 400; non-admin create → 403.
  - Apply to a 2000 booking → 200, `discount` 200, `totalPrice` 1800.
  - A fixed 5000 code on a 2000 booking → total 0, never negative.
  - Applying a second code → 400 with the exact message.
  - Unknown, expired and not-yet-valid codes each return 400 with their exact message.
  - `perUserLimit: 1` and the same user applying it to a second booking → 400 per-user message.
  - A code with `maxRedemptions: 1` after one use → 400 exhausted.
  - **Concurrency:** a code with `maxRedemptions: 1`; a Newman-independent step runs `node scripts/promo-race.js` (Step 3 creates it) that fires 20 parallel applies from 20 different users' bookings and exits non-zero unless exactly one returns 200 and the GET promo shows `redemptionCount: 1`.
  - A failed apply leaves `redemptionCount`, `discount` and `totalPrice` unchanged.
  - Booking with `totalPrice` 0 (provider `dailyRate` 0) → 400 "Booking has no price to discount".
  - Editing the dates of a booking that has a 10% promo → `discount` and `totalPrice` re-derived from the new subtotal (2-day 2000 → 3-day 3000 gives `discount` 300, `totalPrice` 2700).
- [ ] **Step 2: Run; expect failures.**
- [ ] **Step 3: Implement.**
  - Redeem with one `PromoCode.findOneAndUpdate({ _id, validFrom: {$lte: now}, validTo: {$gte: now}, $expr: {$lt: ['$redemptionCount','$maxRedemptions']} }, { $inc: { redemptionCount: 1 } }, { new: true })`; if it returns null, run a read to pick the specific error message.
  - Check the per-user count before the increment and write the `PromoRedemption` after; if booking save fails, decrement and delete the redemption (compensate).
  - Guard "already has a promo" with `Booking.findOneAndUpdate({ _id, promo: null }, ...)` so two simultaneous applies to the same booking cannot both succeed.
  - In `controllers/bookings.js` update recompute: when the booking has a promo, `discount = computeDiscount(promo, subtotal)` and `totalPrice = subtotal - discount`.
  - Create `scripts/promo-race.js`.
- [ ] **Step 4: Run; expect green, including the race script.**
- [ ] **Step 5: Commit** `feat: promo codes with atomic redemption`.

### Task 6: Admin audit log

**Review:** per-task — security (immutability of audit data)

**Files:**
- Create: `models/AuditLog.js`, `controllers/audit.js`, `routes/audit.js`
- Modify: `controllers/bookings.js` (write entries), `server.js`
- Test: collection folder `Audit`

**Interfaces:**
- Consumes: Task 3 booking controllers.
- Produces:
  - `AuditLog { admin, action: 'view'|'edit'|'delete', booking: ObjectId, timestamp: Date default now, before: Mixed, after: Mixed }` with indexes `{ admin:1, timestamp:-1 }`, `{ booking:1, timestamp:-1 }`, `{ timestamp:-1 }`.
  - `recordAudit({ admin, action, booking, before, after }) → Promise<void>` exported from `controllers/audit.js`, called only when `req.user.role === 'admin'`.
  - `GET /api/v1/audit?admin=&booking=&from=&to=&page=&limit=` (admin) → `{ success, count, total, page, pages, data }`, default `limit` 20, max 100.
  - No `PUT`, `PATCH`, `DELETE` or `POST` route exists under `/api/v1/audit`; the schema's `pre('updateOne'|'findOneAndUpdate'|'deleteOne'|'deleteMany'|'updateMany'|'save' on existing docs)` hooks throw.

- [ ] **Step 1: Write failing assertions:**
  - Admin `GET` a user's booking → one `view` entry with `admin`, `booking`, `timestamp`.
  - Admin `PUT` changing `date` → one `edit` entry whose `before` and `after` contain only `date`. A `PUT` whose values equal the stored values writes no entry.
  - Admin `PUT` with a junk field `foo` → ignored, not in `after`.
  - Admin `DELETE` → one `delete` entry whose `before` is the removed booking's fields.
  - A regular user's view, edit and delete → no entries.
  - Filters: by `admin`, by `booking`, by `from`/`to`; `to` before `from` → 400; page 2 with `limit=1` returns the next entry and correct `pages`.
  - `PUT /api/v1/audit/:id`, `DELETE /api/v1/audit/:id`, `PATCH`, `POST` → 404 (no route).
  - Non-admin `GET /api/v1/audit` → 403.
  - Performance: a seeded set of 5000 entries (script `scripts/seed-audit.js`, run by `run-newman.sh` before this folder) and a page request asserts `pm.response.responseTime < 3000`.
- [ ] **Step 2: Run; expect failures.**
- [ ] **Step 3: Implement.** Compute the diff by comparing the pre-update document with the whitelisted update fields (`date, returnDate, provider`), storing only keys whose value differs. Await `recordAudit` before sending the response, so a booking mutation never succeeds without its log entry; for delete, write the entry before `deleteOne`. Add the immutability hooks.
- [ ] **Step 4: Run; expect green.**
- [ ] **Step 5: Commit** `feat: immutable admin audit log`.

### Task 7: Support tickets

**Files:**
- Create: `models/Ticket.js`, `controllers/tickets.js`, `routes/tickets.js`
- Modify: `server.js`
- Test: collection folder `Tickets`

**Interfaces:**
- Consumes: Task 3 `Booking`, `protect`, `authorize`.
- Produces:
  - `Ticket { user, booking, category: 'billing'|'vehicle issue'|'other', subject, description, status: 'open'|'in progress'|'resolved' default 'open', comments: [{ author, role, text, createdAt }], createdAt }`.
  - Routes: `POST /api/v1/tickets`, `GET /api/v1/tickets` (own; admin: all, filter `?status=&category=`), `GET /api/v1/tickets/:id`, `POST /api/v1/tickets/:id/comments`, `PUT /api/v1/tickets/:id/status` (admin).

- [ ] **Step 1: Write failing assertions:**
  - Create for own booking → 201, status `open`.
  - Create for another user's booking → 403; for a nonexistent booking → 404; invalid category → 400.
  - User lists only own; admin lists all; `?status=open` and `?category=billing` filter.
  - User comments on own ticket → 200, comment has `author`, `role`, `createdAt`; admin reply → 200 with `role: 'admin'`.
  - Admin sets `in progress` then `resolved` → 200; invalid status → 400; user calling status → 403.
  - Comment on a resolved ticket (user and admin) → 400 "Ticket is resolved".
  - User views another's ticket → 403; malformed id → 404.
- [ ] **Step 2: Run; expect failures.**
- [ ] **Step 3: Implement.** Comments are appended with `$push`, with the resolved check in the update filter (`{ _id, status: { $ne: 'resolved' } }`) so a status change racing a comment cannot slip one through.
- [ ] **Step 4: Run; expect green.**
- [ ] **Step 5: Commit** `feat: support tickets`.

### Task 8: Return inspection and late fee

**Files:**
- Create: `models/Inspection.js`, `controllers/inspections.js`, `routes/inspections.js`
- Modify: `server.js`
- Test: collection folder `Inspections`

**Interfaces:**
- Consumes: Task 3 `Booking` (`returnDate`) and `Provider.lateFeePerHour`.
- Produces:
  - `Inspection { booking (unique), actualReturnTime, odometer: Number >= 0, fuelLevel: Number 0..100, damageNotes: String, lateHours: Number, lateFee: Number, createdAt, dispute: { comment, createdAt, status: 'open'|'resolved'|'dismissed', resolutionNote } | null }`.
  - `calcLateFee(returnDate: Date, actualReturn: Date, feePerHour: number) → { lateHours: number, lateFee: number }` (`lateHours = max(0, ceil((actual - scheduled) / 3600000))`).
  - Routes: `POST /api/v1/bookings/:id/inspection` (admin), `GET /api/v1/bookings/:id/inspection` (owner or admin).

- [ ] **Step 1: Write failing assertions with provider `lateFeePerHour: 200`:**
  - Returned exactly on time → `lateHours` 0, `lateFee` 0.
  - 1 minute late → 1 hour, 200.
  - 2 h 00 m late → 2, 400; 2 h 01 m late → 3, 600.
  - Early → 0.
  - Provider with `lateFeePerHour: 0` returned 3 hours late → `lateHours` 3, `lateFee` 0 (a number, not NaN).
  - Second inspection for the same booking → 409.
  - Non-admin create → 403; missing `odometer` → 400; fuel 150 → 400.
  - Owner `GET` → 200; another user → 403; admin → 200; no inspection yet → 404; malformed booking id → 404.
- [ ] **Step 2: Run; expect failures.**
- [ ] **Step 3: Implement `calcLateFee` in `controllers/inspections.js` as an exported pure function and use it in create.** Store the computed fee; never accept `lateFee` from the client.
- [ ] **Step 4: Run; expect green.**
- [ ] **Step 5: Commit** `feat: return inspection with late fee`.

### Task 9: Inspection disputes

**Review:** per-task — concurrency (one dispute per inspection, race on resolve)

**Files:**
- Modify: `controllers/inspections.js`, `routes/inspections.js`
- Test: collection folder `Disputes`

**Interfaces:**
- Consumes: Task 8 `Inspection`.
- Produces: `POST /api/v1/bookings/:id/inspection/dispute` body `{ comment }` (owner); `PUT /api/v1/bookings/:id/inspection/dispute` body `{ status: 'resolved'|'dismissed', resolutionNote? }` (admin). Messages, exact: `Dispute window of 7 days has passed`, `A dispute has already been submitted`.

- [ ] **Step 1: Write failing assertions:**
  - Owner disputes within 7 days → 200, dispute `open`.
  - Second dispute → 400 with the exact message; another user → 403; empty comment → 400.
  - Inspection `createdAt` aged to 7 days + 1 minute ago → 400 window message; aged to 7 days - 1 minute → 200. The ageing is done by `scripts/age-inspection.js <bookingId> <days>` called from the collection's pre-request step; no test-only API route is added.
  - Admin resolve → 200 `resolved`; admin dismiss on another → `dismissed`; resolve with no dispute → 404; invalid status → 400; user calling resolve → 403; resolving an already closed dispute → 400; malformed booking id on submit and on resolve → 404.
- [ ] **Step 2: Run; expect failures.**
- [ ] **Step 3: Implement.** Submit with `findOneAndUpdate({ booking, dispute: null, createdAt: { $gte: now - 7d } }, { $set: { dispute } })` and derive the specific error from a follow-up read when it matches nothing; resolve with a filter `{ 'dispute.status': 'open' }`.
- [ ] **Step 4: Run; expect green.**
- [ ] **Step 5: Commit** `feat: inspection disputes`.

### Task 10: Statistics report

**Files:**
- Create: `controllers/stats.js`, `routes/stats.js`
- Modify: `server.js`
- Test: collection folder `Stats`

**Interfaces:**
- Consumes: Task 3 `Booking`, `Provider`.
- Produces: `GET /api/v1/stats?from=&to=` (admin) → `{ success, data: { total, perProvider: [{ provider, name, count }], perMonth: [{ month: 'YYYY-MM', count }], top5: [{ provider, name, count }] } }`; ranges filter on `Booking.date`, inclusive. Missing or invalid range → 400; `to` before `from` → 400.

- [ ] **Step 1: Write failing assertions on a seed with known counts (2 providers, bookings across two months):**
  - `total`, `perProvider` and `perMonth` match the seed exactly.
  - `top5` is sorted descending with at most 5 items (seed 6 providers via `scripts/seed-stats.js`, run by `run-newman.sh`).
  - An empty range → `total` 0 and empty arrays; a one-day range includes bookings on both boundary days.
  - Non-admin → 403; no token → 401; `to` before `from` → 400.
  - `pm.response.responseTime < 3000` on 5000 seeded bookings.
- [ ] **Step 2: Run; expect failures.**
- [ ] **Step 3: Implement with a single `Booking.aggregate` using `$facet` (`total`, `perProvider` with `$lookup` to providers, `perMonth` via `$dateToString` in UTC, `top5` as `perProvider` limited).** Add the index `{ date: 1, provider: 1 }` on `Booking`.
- [ ] **Step 4: Run; expect green.**
- [ ] **Step 5: Commit** `feat: admin statistics report`.

### Task 11: Full-suite Newman run and presentation demo set

**Files:**
- Modify: `scripts/run-newman.sh`, `__tests__/rental.postman_collection.json`, `package.json`
- Create: `__tests__/demo.postman_collection.json` (7-minute demo order), `README.md` (how to run, env vars, seeded accounts)

**Interfaces:**
- Consumes: every earlier folder.
- Produces: `npm test` runs all folders in dependency order (Auth, Bookings, LoginProtection, Promos, Audit, Tickets, Inspections, Disputes, Stats) against a fresh database, and exits non-zero on any failure; an HTML or JSON report is written to `newman-report.json` (gitignored). The demo collection shows only the highlight requests: register, login, logout then 401 replay, 4th booking, promo race result, audit entry, lockout, 429, ticket on resolved, late fee, stats.

- [ ] **Step 1: Make `run-newman.sh` drop the test database first (only after confirming the name ends in `_test`), run the seed scripts, run the full collection, then run the `LoginProtection` 429 request alone with `RATE_LIMIT_FORCE=1` on a restarted server.**
- [ ] **Step 2: Run `npm test` twice in a row; expect both runs fully green** (proves independence from leftover data).
- [ ] **Step 3: Time the demo collection; expect the whole run under 60 seconds.**
- [ ] **Step 4: Commit** `test: full newman suite and demo collection`.

### Task 12: Course documents

**Files:**
- Create: `docs/requirements.md`, `docs/use-cases.md`, `docs/sequence-diagrams.md`, `docs/uml-profile-for-api.md`, `docs/work-division.md`

**Interfaces:**
- Consumes: `spec.md`, the final route list from Tasks 1–10.
- Produces: the documents the slide requires. Because this API is built fresh, they cover the whole API, not a diff against a base. They contain Mermaid diagrams: one use-case diagram, one sequence per added capability (promo apply, audit write, login protection, ticket comment, inspection + dispute, stats), and a UML Profile for API table listing method, path, role, request, responses.

- [ ] **Step 1: Write `docs/requirements.md` from the spec, one requirement per row with the task that satisfies it.**
- [ ] **Step 2: Write the use-case, sequence and API-profile documents; every endpoint in the profile must exist in `routes/`** (check with `grep -R "router\." routes`).
- [ ] **Step 3: Write `docs/work-division.md` with the student ID and name and a split in which each of the two students owns both code tasks and documents** (names of the second student left as a placeholder the team fills in).
- [ ] **Step 4: Commit** `docs: requirements, use cases, sequences, API profile`.

---

## Self-Review

- **Spec coverage:** base stories 1–20 → Tasks 1–3 (logout story 5 → Task 2); A promo 21–29 → Task 5; B audit 30–37 → Task 6; C login 38–43 → Task 4; D tickets 44–54 → Task 7; E inspection 55–63 → Tasks 8–9; F stats 64–70 → Task 10; deliverables 71–73 → Tasks 11–12. No gaps.
- **Spec open questions resolved here, flagged for the user:** booking price = `provider.dailyRate × days` with a required `returnDate` on the booking (also used as the scheduled return time for late fees); admins are exempt from the 3-booking limit because the spec is silent; the Extra Credit item is untouched pending the lecturer's answer.
- **Type consistency:** `loadOwnedBooking` (Task 3) is the owner-check helper reused by Tasks 5, 8, 9; `computeDiscount` (Task 5) is the only discount function; `calcLateFee` (Task 8) is the only fee function; error message strings are defined once in Tasks 5 and 9.
- **Review marks:** Task 2 (auth), Task 4 (auth), Task 5 (concurrency), Task 6 (immutable security data), Task 9 (concurrency); all others unmarked.
