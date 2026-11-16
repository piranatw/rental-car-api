# Testing

The project is tested at five levels, from fastest to slowest. Each level exists because the one above it cannot see a certain kind of bug.

| Level | Command | Needs a database | Time | What it proves |
| --- | --- | --- | --- | --- |
| Unit tests | `npm run test:unit` | no | about 3 s | single functions and schemas behave as specified |
| Newman suite | `source config/test-env.sh && npm test` | yes (`_test`) | about 5 min | every endpoint, end to end, with its error cases |
| Robustness suite | `npm run test:robustness` | yes (`_test`) | about 10 s | bad input gets a clean 4xx in the JSON envelope: never a 5xx, never an HTML page |
| Race and index checks | run by `npm test`, or `npm run demo:race -- <name>` | yes (`_test`) | seconds each | parallel requests cannot break a limit; list queries use their index |
| Demo collection | `npm run demo` | yes (development) | about 10 s | the 7-minute presentation path works |

## 1. Unit tests (`__tests__/unit/`)

Run with Node's built-in test runner (`node:test`), so there is nothing to install beyond the project dependencies.

| File | Covers |
| --- | --- |
| `pricing.test.js` | day counting, minimum one day, rounding to cents, percentage and fixed discounts, clamping |
| `paging.test.js` | defaults, strict integer parsing, the 100 maximum, error order, repeated query keys |
| `lockConfig.test.js` | lockout settings from the environment and the fallback for invalid values |
| `authMiddleware.test.js` | `protect` and `authorize` with the database calls replaced by stubs: missing, malformed, forged, expired and revoked tokens, deleted user, role checks |
| `loginLimiter.test.js` | the real limiter on a throwaway server: the 11th request is 429, `Retry-After`, `X-Forwarded-For` cannot dodge it, the test-mode skip and the force switch |
| `models.test.js` | `validateSync()` on the schemas: required fields, ranges, enums, the date-order and promo rules, indexes |
| `serverHeaders.test.js` | the helmet headers and the `/api-docs` page |
| `openapi.test.js` | `openapi.yaml` parses, every `$ref` resolves, every operation has a tag and responses, and the spec lists exactly the routes registered in `routes/*.js` |

Stubbing the database in `authMiddleware.test.js` uses `t.mock.method`, which restores the real functions after each test, so tests do not leak into each other.

## 2. Newman suite (`__tests__/rental.postman_collection.json`)

About 670 requests in folders: Auth, Bookings, LoginProtection, Promos, RateLimit429, Audit, Tickets, Inspections, Disputes (three phases) and Stats. Each request carries `pm.test` assertions on the status code and the body. `scripts/run-newman.sh`:

1. refuses to start unless the database name ends in `_test`, because it drops the whole database;
2. runs `scripts/collection-check.js`, which fails on a duplicate or unlisted folder;
3. drops and reseeds the test database, then runs the folders against a server started with `NODE_ENV=test`;
4. restarts the server with `RATE_LIMIT_FORCE=1` for the `RateLimit429` folder, because the login limiter is skipped in test mode;
5. runs the race and index checks and exits non-zero if anything failed.

To add a folder, add its name to `PASS_A_FOLDERS` in `scripts/run-newman.sh`.

## 2b. Robustness suite (`__tests__/robustness.postman_collection.json`)

A second, separate collection of about 220 requests, run by `scripts/run-robustness.sh` against a fresh `_test` database (same guard as `npm test`). It exists to answer: what happens when a client sends something wrong or hostile? Every request expects a clean 4xx answer in the JSON envelope.

| Folder | What it sends |
| --- | --- |
| 1 Malformed JSON bodies | broken JSON on every write endpoint, a 200 KB body (413), the wrong content type, empty, null, array and string bodies |
| 2 Unknown routes | any other path or method answers a JSON 404 |
| 3 Operator injection | `{"$gt": ""}`, `$ne`, `$regex`, arrays and objects where a string is expected, in bodies and in query strings (`status[$ne]=x`, a key given twice) |
| 4 Fields the client must not control | `role`, `status`, `user`, comment author and time, promo counters, a client `_id`, lockout counters: all ignored |
| 5 Odd ids | `null`, `undefined`, 23 and 25 characters, non-hex, encoded slashes, on every resource |
| 6 Pagination limits | the same 14 bad `page` and `limit` values on bookings, audit and tickets, plus a huge page that must be empty, not an error |
| 7 Odd Authorization headers | lower-case scheme, Basic, no token, two spaces, a token only in the query or a cookie, an unsigned token |
| 8 Text and date edge cases | Thai and emoji text, trimming, length limits, e-mail case, invalid dates, a leap day, a zone-less date-time |

## 3. Race and index checks (`scripts/`)

Postman sends one request at a time, so it cannot show a race. These scripts send 20 requests at once with `Promise.all` and then count outcomes in the database:

| Script | Question it answers |
| --- | --- |
| `promo-race.js`, `promo-edit-race.js`, `promo-undo-check.js` | can a promo be redeemed more often than its limits allow? |
| `ticket-race-check.js` | can comments slip into a ticket that has just been resolved? |
| `dispute-race-check.js`, `dispute-window-check.js` | can one inspection be disputed twice, or after seven days? |
| `inspection-race-check.js`, `late-fee-check.js` | can a booking get two inspections? is the late fee right? |
| `lock-race-check.js`, `lock-expiry-check.js` | do parallel wrong passwords lock the account exactly once? does the lock expire? |
| `audit-immutability-check.js`, `audit-failure-check.js`, `audit-index-check.js` | can an audit entry be changed? is a failed action recorded? is the list index-served? |
| `ticket-index-check.js`, `stats-index-check.js`, `timing-check.js` | do the list and report queries use their index and stay fast? |

`scripts/seed-*.js` and `stats-fixture.js` generate the large data sets those checks need.

## 4. Demo collection

`__tests__/demo.postman_collection.json` is a short, self-contained walk through every feature for the presentation. See "Present the demo" in the README.

## Continuous integration

`.github/workflows/ci.yml` runs the unit tests first, then the Newman suite against a MongoDB 7 service container, on every push to `main` and every pull request.

## Writing a new test

- A pure function or a schema rule: add a `*.test.js` file in `__tests__/unit/`. No database, no server.
- A new endpoint: add requests to the collection, with at least the success case, one validation failure, the unauthenticated case and the wrong-role case; register the folder in `run-newman.sh`.
- A rule that must hold under concurrency: add a script in `scripts/` that fires parallel requests and counts the database afterwards.
