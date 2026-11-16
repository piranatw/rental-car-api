# Requirements

Rental Car Booking REST API (Project #7), course 2110336 SW Dev Practice.

## Scope

This document describes the WHOLE API, because the modified class code (Assignment 7) and the added capabilities form one API. It restates the requirements of [`spec.md`](../spec.md) (73 user stories) and, for each one, names the endpoint that satisfies it and how it is verified.

> **Modified from the class code (Assignment 7, VacQ).** The starting point is the Assignment 7 source exactly as received, commit `c617bb6` ("base: Assignment 7 source as received"). See what differs with `git diff c617bb6 main --stat`. In short: Hospital and Appointment became Provider and Booking; the A7 auth code was modified (the role is no longer chosen by the client, one `401` for every login failure, logout with token revocation, account lockout and a per-IP limit, no hard-coded seed password); and promo codes, the audit log, support tickets, return inspections and statistics were added.

Related documents: [use cases](use-cases.md), [sequence diagrams](sequence-diagrams.md), [UML profile for API](uml-profile-for-api.md).

## How to read the "Verified by" column

- **Postman folder** names are the top-level folders of `__tests__/rental.postman_collection.json`: Auth, Bookings, LoginProtection, Promos, Tickets, Audit, Inspections, Disputes, Stats and RateLimit429. `npm test` runs all of them with Newman (see the README).
- **Script** names are files in `scripts/`. They run inside `npm test` (`scripts/run-newman.sh`) and can be run alone as the README describes. They print counts and exit non-zero on a violation.
- All paths below start with `/api/v1`.
- "Anyone", "logged in", "owner or admin", "owner only" and "admin" are defined in the [UML profile](uml-profile-for-api.md).

## Base requirements (stories 1 to 20)

| ID | Requirement | Actor | Endpoint(s) | Verified by |
| --- | --- | --- | --- | --- |
| R01 | Register with name, telephone, email and password | Visitor | `POST /auth/register` | Postman Auth |
| R02 | Registration is rejected when the email is already registered (400 `Email already registered`) | Visitor | `POST /auth/register` | Postman Auth |
| R03 | Log in with email and password | Registered user | `POST /auth/login` | Postman Auth |
| R04 | Log out | Registered user | `POST /auth/logout` | Postman Auth |
| R05 | A logged-out token is rejected afterwards (401, server-side revocation) | Registered user | any protected route, for example `GET /auth/me` | Postman Auth; demo collection section 2 (revoked-token replay) |
| R06 | The password is never returned by any API | Registered user | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` (password is `select: false`) | Postman Auth |
| R07 | Bookings and personal data are visible only to the owner and to admins | Registered user | `GET /bookings`, `GET /bookings/:id`, `GET /auth/me` | Postman Bookings |
| R08 | List providers with name, address and telephone | Anyone | `GET /providers`, `GET /providers/:id` | Postman Bookings |
| R09 | Each provider carries a late fee per hour (`lateFeePerHour`) | Admin | `POST /providers`, `PUT /providers/:id` | Postman Bookings, Inspections |
| R10 | Admin creates, edits and deletes providers (delete refused with 409 while the provider has bookings) | Admin | `POST /providers`, `PUT /providers/:id`, `DELETE /providers/:id` | Postman Bookings |
| R11 | Book a car by date and provider | Registered user | `POST /providers/:providerId/bookings` | Postman Bookings |
| R12 | At most 3 bookings per user; the 4th is rejected (400 `A user can book at most 3 cars`) | Registered user | `POST /providers/:providerId/bookings` | Postman Bookings |
| R13 | View only my own bookings | Registered user | `GET /bookings` | Postman Bookings |
| R14 | Edit my own booking (date, return date, provider) | Registered user | `PUT /bookings/:id` | Postman Bookings |
| R15 | Delete my own booking | Registered user | `DELETE /bookings/:id` | Postman Bookings |
| R16 | Blocked from viewing, editing or deleting another user's booking (403 `Not authorized to access this booking`) | Registered user | `GET`, `PUT`, `DELETE /bookings/:id` | Postman Bookings |
| R17 | Admin views any booking | Admin | `GET /bookings`, `GET /bookings/:id` | Postman Bookings |
| R18 | Admin edits any booking | Admin | `PUT /bookings/:id` | Postman Bookings |
| R19 | Admin deletes any booking | Admin | `DELETE /bookings/:id` | Postman Bookings |
| R20 | Protected endpoints reject a caller without a valid token (401 `Not authorized to access this route`) | Visitor | every route except register, login, `GET /providers`, `GET /providers/:id` | Postman Bookings, Auth |

## A. Promo codes (stories 21 to 29)

| ID | Requirement | Actor | Endpoint(s) | Verified by |
| --- | --- | --- | --- | --- |
| R21 | Admin creates a code: code string, `percentage` or `fixed`, validity period, maximum total redemptions, optional per-user limit | Admin | `POST /promos`, `GET /promos` | Postman Promos |
| R22 | Invalid definitions are rejected (percentage over 100, negative amount, end before start); duplicate code is 409 `Promo code already exists` | Admin | `POST /promos` | Postman Promos |
| R23 | Apply one code to a booking | Registered user | `POST /bookings/:id/promo` | Postman Promos |
| R24 | The discount applies to the booking's total price, never below 0 | Registered user | `POST /bookings/:id/promo` | Postman Promos |
| R25 | Specific messages: unknown, not yet valid, expired, exhausted, per-user limit | Registered user | `POST /bookings/:id/promo` | Postman Promos |
| R26 | A second code on the same booking is refused (400 `Booking already has a promo code`) | Registered user | `POST /bookings/:id/promo` | Postman Promos |
| R27 | The redemption count is incremented atomically, so concurrent requests never exceed the maximum | Operator | `POST /bookings/:id/promo` | `scripts/promo-race.js` (20-way race), `scripts/promo-edit-race.js` (apply racing an edit); Postman Promos |
| R28 | A rejected application leaves the redemption count and booking price unchanged | Operator | `POST /bookings/:id/promo` | `scripts/promo-undo-check.js`; Postman Promos |
| R29 | A non-admin cannot create a promo code (403) | Registered user | `POST /promos` | Postman Promos |

## B. Admin audit log (stories 30 to 37)

| ID | Requirement | Actor | Endpoint(s) | Verified by |
| --- | --- | --- | --- | --- |
| R30 | An entry is written whenever an admin views a booking | Operator | `GET /bookings`, `GET /bookings/:id` | Postman Audit |
| R31 | An entry is written whenever an admin edits a booking, with before and after values of the changed fields | Operator | `PUT /bookings/:id` (and an admin promo apply) | Postman Audit |
| R32 | An entry is written whenever an admin deletes a booking, holding the deleted values | Operator | `DELETE /bookings/:id` | Postman Audit |
| R33 | Each entry holds admin id, action, booking id and timestamp (plus `status` and `reason`) | Operator | `GET /audit` | Postman Audit |
| R34 | Admin queries the log by admin, booking or date range | Admin | `GET /audit` | Postman Audit |
| R35 | Results are paginated and each page answers within 3 seconds | Admin | `GET /audit` (`page`, `limit`, at most 100) | Postman Audit (5 `responseTime` assertions); `scripts/audit-index-check.js` (100,000 entries, deep pages, no blocking sort) |
| R36 | No API modifies or deletes entries; the persistence layer exposes no mutating path | Operator | none exists: POST, PUT, PATCH and DELETE on `/audit` answer 404 | `scripts/audit-immutability-check.js`; Postman Audit |
| R37 | A non-admin is rejected (403) | Registered user | `GET /audit` | Postman Audit |

Additional audit behaviour (design decision beyond the stories): the entry is written BEFORE the mutation; a failed mutation appends a new `failed` entry; verified by `scripts/audit-failure-check.js`.

## C. Login protection (stories 38 to 43)

| ID | Requirement | Actor | Endpoint(s) | Verified by |
| --- | --- | --- | --- | --- |
| R38 | 5 consecutive failed logins lock the account for 15 minutes | Operator | `POST /auth/login` | Postman LoginProtection; `scripts/lock-race-check.js` (parallel guesses) |
| R39 | A locked account refuses the correct password until the lock expires (same 401 `Invalid credentials`) | Operator | `POST /auth/login` | Postman LoginProtection; `scripts/lock-expiry-check.js` |
| R40 | A successful login resets the failed-attempt counter | Registered user | `POST /auth/login` | Postman LoginProtection |
| R41 | Login limited to 10 requests per minute per IP | Operator | `POST /auth/login` (`loginLimiter`) | Postman RateLimit429 (second server pass with the limiter forced on); demo collection last section |
| R42 | HTTP 429 with a retry-after time, in the `Retry-After` header and as `retryAfter` in the body | Client | `POST /auth/login` | Postman RateLimit429 |
| R43 | Wrong password and unknown email give the same generic error (401 `Invalid credentials`) | Operator | `POST /auth/login` | Postman LoginProtection; `scripts/timing-check.js` (equal cost for wrong password, unknown email and locked account) |

## D. Support tickets (stories 44 to 54)

| ID | Requirement | Actor | Endpoint(s) | Verified by |
| --- | --- | --- | --- | --- |
| R44 | Open a ticket linked to one of my own bookings with category (`billing`, `vehicle issue`, `other`), subject and description | Registered user | `POST /tickets` | Postman Tickets |
| R45 | Ticket creation is rejected for a booking that is not mine (403 `Not authorized to open a ticket for this booking`), admins included | Registered user | `POST /tickets` | Postman Tickets |
| R46 | View my own tickets with their status (`open`, `in progress`, `resolved`) | Registered user | `GET /tickets`, `GET /tickets/:id` | Postman Tickets |
| R47 | Add follow-up comments until the ticket is resolved | Registered user | `POST /tickets/:id/comments` | Postman Tickets; `scripts/ticket-race-check.js` |
| R48 | Admin views all tickets | Admin | `GET /tickets` | Postman Tickets; `scripts/ticket-index-check.js` (60,000 tickets) |
| R49 | Admin filters tickets by status or category | Admin | `GET /tickets?status=&category=` | Postman Tickets |
| R50 | Admin replies to a ticket | Admin | `POST /tickets/:id/comments` | Postman Tickets |
| R51 | Admin changes a ticket's status | Admin | `PUT /tickets/:id/status` | Postman Tickets |
| R52 | Every comment records author, role and timestamp (taken from the token and the server clock) | Operator | `POST /tickets/:id/comments` | Postman Tickets |
| R53 | New comments on a resolved ticket are rejected (400 `Ticket is resolved`) | Operator | `POST /tickets/:id/comments` | Postman Tickets; `scripts/ticket-race-check.js` (status flip racing comments) |
| R54 | Blocked from viewing other users' tickets (403 `Not authorized to access this ticket`) | Registered user | `GET /tickets/:id`, `POST /tickets/:id/comments` | Postman Tickets |

## E. Return inspection, late fee and dispute (stories 55 to 63)

| ID | Requirement | Actor | Endpoint(s) | Verified by |
| --- | --- | --- | --- | --- |
| R55 | Admin records an inspection: actual return time, odometer, fuel level, damage notes | Admin | `POST /bookings/:id/inspection` | Postman Inspections; `scripts/inspection-race-check.js` (one inspection per booking under a race) |
| R56 | Late fee = overdue time rounded up to whole hours x the provider's `lateFeePerHour`, computed on the server and stored | Operator | `POST /bookings/:id/inspection` | Postman Inspections (on time, 1 minute late, exactly N hours, N hours and a minute); `scripts/late-fee-check.js` (every minute offset against an independent formula) |
| R57 | No fee when returned on time or early | Operator | `POST /bookings/:id/inspection` | Postman Inspections; `scripts/late-fee-check.js` |
| R58 | The owner views the inspection report of their own booking | Registered user | `GET /bookings/:id/inspection` | Postman Inspections |
| R59 | Blocked from viewing other users' reports (403 `Not authorized to access this booking`) | Registered user | `GET /bookings/:id/inspection` | Postman Inspections |
| R60 | The owner submits one dispute comment within 7 days of the inspection record | Registered user | `POST /bookings/:id/inspection/dispute` | Postman Disputes (3 phases, with the inspection aged in the database by `scripts/age-inspection.js`); `scripts/dispute-window-check.js`; `scripts/dispute-race-check.js` |
| R61 | A second dispute, or one after 7 days, is rejected with a specific message (`A dispute has already been submitted`, `Dispute window of 7 days has passed`) | Registered user | `POST /bookings/:id/inspection/dispute` | Postman Disputes; `scripts/dispute-window-check.js` |
| R62 | Admin resolves a dispute | Admin | `PUT /bookings/:id/inspection/dispute` | Postman Disputes |
| R63 | Admin dismisses a dispute | Admin | `PUT /bookings/:id/inspection/dispute` | Postman Disputes |

## F. Statistics (stories 64 to 70)

| ID | Requirement | Actor | Endpoint(s) | Verified by |
| --- | --- | --- | --- | --- |
| R64 | Admin views a statistics report within a date range | Admin | `GET /stats?from=&to=` | Postman Stats |
| R65 | Total number of bookings in the range | Admin | `GET /stats` (`total`) | Postman Stats |
| R66 | Bookings per provider | Admin | `GET /stats` (`perProvider`) | Postman Stats |
| R67 | Bookings per month | Admin | `GET /stats` (`perMonth`) | Postman Stats |
| R68 | Top 5 most booked providers | Admin | `GET /stats` (`top5`) | Postman Stats |
| R69 | All figures come from one database aggregation and answer within 3 seconds | Operator | `GET /stats` | Postman Stats (1 `responseTime` assertion, on 5000 seeded bookings); `scripts/stats-index-check.js` (100,000 bookings over 3 years: index used, 3-year, 1-month and 1-day ranges each under 3000 ms, totals consistent) |
| R70 | A non-admin gets HTTP 403 | Registered user | `GET /stats` | Postman Stats |

## Deliverables and demo (stories 71 to 73)

| ID | Requirement | Actor | Where | Verified by |
| --- | --- | --- | --- | --- |
| R71 | A Postman collection runnable in Postman Runner or Newman that proves each requirement including failure paths | Grader | `__tests__/rental.postman_collection.json` (test suite) and `__tests__/demo.postman_collection.json` (7-minute demo), see the README | `npm test` (`scripts/run-newman.sh`), `npm run demo`; `scripts/collection-check.js` guards against duplicate or unlisted folders |
| R72 | The code and the documents each student wrote are visible so that individual contribution is assessable | Grader | the git history (`git shortlog`, `git blame`) and the GitHub Contributors page | each person commits under their own name and email |
| R73 | Present within 7 minutes, Q and A up to 3 minutes | Presenter | README section "Present the demo (7 minutes)" | rehearsal by the team (not testable in code) |

## Non-functional requirements and constraints

| ID | Requirement (project listing) | How it is met | Verified by |
| --- | --- | --- | --- |
| N1 | Web API only, REST, backend only | Express routers under `/api/v1`, JSON, no frontend | `docs/uml-profile-for-api.md` lists every route |
| N2 | MongoDB as the database | Mongoose 8 models; counters, locks and revocations are stored in the database, not in process memory | `models/*.js` |
| N3 | Authentication by email and password | JWT bearer token after `POST /auth/login`; passwords hashed with bcrypt | Postman Auth |
| N4 | User transactions are confidential | Owner or admin checks in the controllers; password and lock state never selected; the audit log, statistics and promo administration are admin-only | Postman Bookings, Tickets, Inspections, Audit, Stats |
| N5 | Every request answers within 3 seconds | Indexed queries (audit, tickets, statistics), one aggregation for statistics, summaries instead of full threads in the ticket list, bounded page size | see "Where the 3-second bound is measured" below |
| N6 | Usable and tested with Postman | Two Postman collections with their environments, runnable by Runner or Newman | `npm test`, `npm run demo` |

### Where the 3-second bound is measured

- Postman `responseTime` assertions in the collection (`pm.response.responseTime` below 3000 ms): five in folder Audit (unfiltered page, filtered by admin, date range, filtered by booking, deep page) and one in folder Stats, run against a test database seeded with 5000 audit entries and 5000 bookings (`scripts/seed-audit.js`, `scripts/seed-stats.js`).
- `scripts/audit-index-check.js`, `scripts/ticket-index-check.js` and `scripts/stats-index-check.js` load 100,000 audit entries, 60,000 tickets and 100,000 bookings into a scratch database, assert that the winning query plan uses the intended index (no collection scan, no blocking sort) and call the real handlers, each of which must answer 200 in under 3000 ms.
- `scripts/timing-check.js` is NOT a 3-second check: it proves that a wrong password, an unknown email and a locked account cost the same time (no timing difference that could reveal an account).
- Limit stated honestly (README "Known limits"): statistics are linear in the number of bookings in the requested range. On an Atlas M0 free-tier cluster the team measured 2.26 s for 1,000,000 bookings in one range and extrapolates that 3 s would be crossed near 1.3 million bookings in one range. List endpoints compute `total` with `countDocuments`, which is linear on unselective filters.

## Interpretations

The spec leaves these open; the team chose as follows (also in the README under "Design decisions"). They are decisions, not facts from the spec.

1. **Admins are exempt from the 3-booking limit.** The spec says "a user holds at most 3 bookings" and is silent about admins.
2. **Price = provider `dailyRate` x number of days, at least 1 day.** The spec requires only that a total price exists. A booking therefore has a required `returnDate` (which may equal `date`).
3. **The scheduled return time is the END of the booking's `returnDate` in UTC (23:59:59.999Z).** Returning at any moment on the return date is on time. Late hours are rounded up from that instant.
4. **The dispute window of 7 days is counted from the inspection record** (`createdAt` of the inspection), inclusive.
5. **A locked account answers the same `401 Invalid credentials`** as a wrong password, so the lock cannot be used to discover registered emails (the spec's story 43 asks for identical errors for wrong password and unknown email).
6. **An admin's promo apply is logged as an `edit`** and the redemption counts against the booking's owner, not the admin.
7. **A ticket can be opened only for the caller's own booking, admins included.**
8. **The statistics range is applied to the booking's pickup `date`** (`basis: "booking.date"`), inclusive in UTC; a date-only `to` covers that whole day; the span is at most 3653 days.
9. **Deleting a booking does not release its promo redemption**, and deleting a provider that has bookings is refused with 409.

## Not implemented

- Adjusting the late fee after a dispute is resolved. Resolving records a decision and leaves `lateFee` unchanged.
- The Extra Credit item: the slide does not define it, and the team is waiting for the lecturer's answer (spec "Open questions"). No Extra Credit video or link is part of this repository.
- Database transactions: a process crash in the middle of a promo apply can leave a claimed booking or a redemption count behind (README "Known limits").
- Payment, notifications, multi-factor authentication, password reset and a frontend are out of scope in the spec.
