# Architecture

Rental Car Booking REST API (Project #7). This page explains how the code is organised and why, so a new reader can find where a rule lives. For the list of endpoints see [uml-profile-for-api.md](uml-profile-for-api.md) or the interactive `/api-docs`.

## Layers

```
HTTP request
   │
   ▼
server.js            helmet, cors, JSON body parser, cookie parser, /api-docs, route mounting
   │
   ▼
routes/*.js          one router per resource: which path, which method, which middleware
   │
   ▼
middleware/          protect (who are you), authorize (are you allowed), loginLimiter (10 per minute per IP)
   │
   ▼
controllers/*.js     the rules of each resource: validation, ownership, pricing, audit entries
   │
   ▼
models/*.js          Mongoose schemas: field types, required fields, ranges, indexes
   │
   ▼
MongoDB
```

`utils/pricing.js` and `utils/paging.js` are small leaf modules with no dependencies. They hold the two rules that several controllers share (how a price and a discount are computed, how `page` and `limit` are validated), so each rule has exactly one implementation.

## Request lifecycle

1. `helmet()` adds the security headers; `cors()` allows cross-origin callers; `express.json()` parses the body.
2. The router matches the path. Inspection routes are mounted at `/api/v1/bookings/:id/inspection` **before** `/api/v1/bookings`, otherwise `/bookings/:id` would swallow them.
3. `protect` reads `Authorization: Bearer <jwt>`, verifies the signature and expiry, checks the token's SHA-256 hash against the revoked tokens, and loads the user. Every failure gives the same 401 body, so a caller cannot tell a bad token from a revoked one.
4. `authorize('admin')` compares the user's role with the route's allowed roles and answers 403 otherwise.
5. The controller validates input, checks ownership (an owner or an admin for most booking and ticket routes), does the work and answers with the common envelope: `{ success: true, data }` or `{ success: false, message }`.
6. Anything unexpected is caught in the controller and answered as `500 Server error`; the real message goes to the server log only.

## Where each rule lives

| Rule | File |
| --- | --- |
| Password hashing, token signing, role enum | `models/User.js` |
| Token check, revocation, role check | `middleware/auth.js` |
| 10 logins per minute per IP, 429 with `Retry-After` | `middleware/loginLimiter.js` |
| 5 failed logins lock an account for 15 minutes (env-tunable) | `controllers/auth.js`, `config/lockConfig.js` |
| Price = daily rate x days, discount, rounding | `utils/pricing.js` |
| At most 3 bookings for a normal user | `controllers/bookings.js` (`addBooking`, reached through `POST /providers/:providerId/bookings`) |
| Promo validity, limits and the atomic redemption | `controllers/promos.js`, `models/PromoCode.js`, `models/PromoRedemption.js` |
| Audit entries for admin views, edits and deletes | `controllers/audit.js` (writer), `models/AuditLog.js` |
| Ticket status and the comment thread | `controllers/tickets.js`, `models/Ticket.js` |
| Late fee, one inspection per booking, dispute window | `controllers/inspections.js`, `models/Inspection.js` |
| Statistics aggregation | `controllers/stats.js` |

## Design decisions worth knowing

**One writer per rule.** Pricing and paging are single modules. A change to how a discount is rounded is one edit, and the unit tests in `__tests__/unit/pricing.test.js` pin the behaviour.

**Atomic updates instead of read-then-write.** Several rules would break if two requests arrived at the same time: redeeming the last use of a promo, commenting on a ticket that is being resolved, disputing an inspection twice, locking an account on the fifth failed login. Each is a single MongoDB operation with the rule inside its filter (for example "increment only while `redemptionCount < maxRedemptions`"), so the database picks exactly one winner. The `scripts/*-race*.js` checks fire 20 parallel requests at each of these and count the outcomes.

**Audit before action.** For an admin view, edit or delete, the audit entry is written first and the booking is changed afterwards. If the change then fails, a second entry with status `failed` is appended. Entries are never edited, and the audit model refuses every update and delete path, so the log can only grow.

**Plain ids where history matters.** `AuditLog.booking`, `Ticket.booking` and the inspection keep a plain ObjectId rather than a populated reference. A ticket or an audit entry stays meaningful after its booking is deleted.

**Same answer for different failures.** A wrong password, an unknown email and a locked account all answer `401 Invalid credentials`. A malformed id in a path answers like a missing resource (404). Both choices stop a caller from learning what exists.

**Strict input handling.** Pagination is rejected when out of range instead of being clamped; a date-time without a zone is rejected instead of being guessed; fields a client must not set (`role`, `redemptionCount`, comment author) are ignored or never read from the body.

**`trust proxy` is off on purpose.** The login limiter counts the socket address, so a caller cannot dodge it by sending `X-Forwarded-For`. The consequence for deployment is described in [deployment.md](deployment.md).

## Data model

The class diagram of every collection is at the end of [uml-profile-for-api.md](uml-profile-for-api.md). Indexes worth noticing:

- `Booking`: `{ date, provider }` serves the statistics range scan.
- `Ticket`: four indexes that all end in `createdAt desc, _id desc`, so every list sort is served in index order.
- `Inspection.booking` is unique: the unique index is what guarantees one inspection per booking under concurrency.
- `RevokedToken.expiresAt` has a TTL index, so a revoked-token row disappears when the token itself would have expired.

## Known trade-offs

There are no multi-document transactions. A crash in the middle of applying a promo can leave a claimed booking or a redemption counter behind; the code undoes each step when it fails normally, but a hard process crash cannot run that undo. The README lists this under "Known limits" together with the measured cost of the statistics report.
