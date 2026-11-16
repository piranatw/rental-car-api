# Rental Car Booking REST API (Project #7)

Backend-only REST API (no frontend) for renting cars from providers, built for the SWD term project. The team demonstrates it through Postman (Collection Runner) or Newman.

Base requirement: register, log in and out, list providers, book up to 3 cars, view / edit / delete bookings (admins can do this for any booking). Six additional requirement blocks:

- **A. Promotion codes:** admin-created codes (percentage or fixed) with global and per-user redemption limits that cannot be over-redeemed under concurrency.
- **B. Admin audit log:** every admin view, edit and delete of a booking is recorded (append-only, with before/after values) and read through `GET /audit`.
- **C. Login protection:** five consecutive failed logins lock the account for 15 minutes, and the login endpoint is limited to 10 requests per minute per IP (HTTP 429 with `Retry-After`).
- **D. Support tickets:** a user opens a ticket about their booking; user and admin exchange comments; an admin sets the status; a resolved ticket accepts no more comments.
- **E. Return inspection, late fee and dispute:** an admin records the return (time, odometer, fuel, damage); the late fee is computed automatically; the owner can dispute once within 7 days and an admin resolves or dismisses it.
- **F. Statistics:** an admin report of bookings per provider and per month over a date range.

## Stack

Node.js, Express 4, Mongoose 8, MongoDB, jsonwebtoken, bcryptjs, express-rate-limit, Postman collections run with Newman.

## Prerequisites

- Node.js and npm. The project was developed and tested on Node 24; the dependencies themselves declare support from Node 16.20, but nothing older than Node 24 has been run here.
- A MongoDB that is **dedicated to this project**. Either:
  - a fresh MongoDB Atlas cluster (new project, new free M0 cluster, a new database user, your current IP in Network Access, then Connect > Drivers to copy the connection string), or
  - a separate local `mongod` on a port nothing else uses, with its own data directory (for example `mongod --dbpath ~/rental-car-mongo/data --port 27555` and `mongodb://127.0.0.1:27555/rental_car_api`). Do not reuse a `mongod` that already serves another project.
- Two database names on that server: `rental_car_api` for development and **`rental_car_api_test`** for the tests (the connection string for tests is the same string with `/rental_car_api_test?` as the path).

Never commit a connection string, password or secret. `config/config.env` and `config/test-env.sh` are git-ignored.

## Setup

```bash
npm install
cp config/config.env.example config/config.env   # then edit the values (placeholders only in the example)
```

### Environment file keys (`config/config.env`)

| Key | Meaning |
| --- | --- |
| `NODE_ENV` | `development` for normal use. `test` turns the IP login limiter off (used by the test suite). |
| `PORT` | Port the server listens on (the demo and `npm run demo` assume 5050). |
| `MONGO_URI` | MongoDB connection string including the database name. |
| `JWT_SECRET` | Long random string used to sign tokens (for example `openssl rand -hex 32`). |
| `JWT_EXPIRE` | Token lifetime, for example `30d`. |
| `JWT_COOKIE_EXPIRE` | Cookie lifetime in days, for example `30`. |
| `SEED_ADMIN_EMAIL` | Email of the admin account created on first start if it does not exist. |
| `SEED_ADMIN_PASSWORD` | Password of that admin account. |
| `LOGIN_MAX_ATTEMPTS` | Optional: consecutive failed logins before an account locks (default 5). |
| `LOGIN_LOCK_MINUTES` | Optional: how long a locked account stays locked (default 15). |

On first start the server also seeds two providers if the collection is empty: Alpha Rentals (dailyRate 1000, lateFeePerHour 200) and Beta Cars (dailyRate 2500, lateFeePerHour 500).

## Start the server

```bash
npm start        # node server.js
npm run dev      # nodemon, restarts on file changes
```

The API is served under `/api/v1`.

## API documentation

`openapi.yaml` (the OpenAPI 3 description) describes all 28 endpoints (request bodies, responses, error messages, who may call what). With the server running, open `http://localhost:5050/api-docs` for the interactive Swagger UI: paste a token into **Authorize** and try the calls from the browser. The spec can also be imported into Postman.

## Run with Docker

```bash
export JWT_SECRET=$(openssl rand -hex 32) SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=choose-a-password
docker compose up --build
```

This starts the API on port 5050 together with its own MongoDB (a named volume keeps the data), so no Atlas cluster is needed.

## Unit tests and continuous integration

```bash
npm run test:unit
```

Runs with Node's built-in test runner and needs no database. It covers the pricing and paging helpers and checks that `openapi.yaml` parses, resolves its references and lists exactly the routes registered in `routes/*.js`, so the documentation cannot drift from the code unnoticed. `.github/workflows/ci.yml` runs these on every push and pull request, then the full Newman suite against a MongoDB service container.

## Run the test suite

Two more checks run without Postman collections of your own: `npm run test:unit` (no database) and `npm run test:robustness` (bad-input checks, needs the `_test` database like the main suite; see [docs/testing.md](docs/testing.md)).

```bash
source config/test-env.sh && npm test
```

`config/test-env.sh` derives `MONGO_URI` for the `rental_car_api_test` database from `config/config.env` and exports `adminEmail` / `adminPassword`. It prints only a confirmation, never the string.

`npm test` (`scripts/run-newman.sh`) takes about 5 minutes. It:

1. refuses to run unless the database name in `MONGO_URI` ends in `_test` (it **drops the whole database**, so this guard protects your real data);
2. checks the collection for duplicate or unlisted folders (`scripts/collection-check.js`);
3. drops the test database, starts the server with `NODE_ENV=test`, seeds 5000 audit entries and 5000 statistics bookings;
4. runs the Postman folders with Newman (Auth, Bookings, LoginProtection, Promos, Tickets, Audit, Inspections, Stats, and Disputes in three phases with database ageing in between);
5. runs the concurrency and index checks in `scripts/` (promo, ticket, dispute, inspection and lock races, audit immutability, timing and so on). The race checks and some index checks create and drop scratch databases named `*_scratch_*`;
6. restarts the server with `RATE_LIMIT_FORCE=1` and runs the `RateLimit429` folder (the 10-per-minute login limiter is only active in this pass);
7. exits non-zero if anything failed. Reports are written to `newman-report*.json` (git-ignored).

## Present the demo (7 minutes)

The demo collection `__tests__/demo.postman_collection.json` (with `__tests__/demo.postman_environment.json`) is self-contained and re-runnable: it registers its own users with random names, computes every date from today, and needs no helper scripts. It has about 50 requests in nine sections: public providers, register/login/logout (including the revoked-token replay), bookings and the 3-booking limit, promo code and its redemption limit, audit log and immutability, tickets, inspection with late fee and dispute, statistics, and finally login protection (lockout and the 429 limiter). The login budget (it stays under the limiter's 10 per minute until the deliberate 429) is written in the collection's description.

Start the API normally so the limiter is on:

```bash
npm start        # NODE_ENV=development, port 5050
```

**In Postman:** import both demo files, select the `rental-car-api-demo` environment, set `baseUrl` (for example `http://localhost:5050`), `adminEmail` and `adminPassword` (the seeded admin), then open the collection, click Run and run all requests in the listed order.

**With Newman:**

```bash
export adminEmail='<seeded admin email>' adminPassword='<seeded admin password>'
npm run demo
```

which runs:

```bash
newman run __tests__/demo.postman_collection.json -e __tests__/demo.postman_environment.json \
  --env-var baseUrl=http://localhost:5050 --env-var adminEmail=$adminEmail --env-var adminPassword=$adminPassword --reporters cli
```

Notes: the run takes about 10 seconds. If the server was started with `NODE_ENV=test` the limiter is off and the single 429 assertion is reported as skipped, not failed.

**Do not run the demo twice within a minute.** The demo spends the whole minute's 10 login requests on purpose (its last section demonstrates the 429 limiter). A second run inside the same minute is stopped on its first login with one clear failure, "RATE LIMIT ALREADY SPENT ... Wait N seconds and run the demo again", and runs nothing else. Rehearse, wait about a minute, then present. Restarting the server also clears the limiter.

**Use the development database for the demo, never the test database.** `source config/test-env.sh` points `MONGO_URI` at the `_test` database (the one `npm test` drops). Do not `source` it in the terminal where you run `npm start` for the demo. To get the admin credentials into the shell that runs `npm run demo` without touching `MONGO_URI`, export them yourself (the same values as `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `config/config.env`), as in the example above, in a SECOND terminal.

### Concurrency proofs from the terminal

The 20-way races cannot be expressed in Postman. Show them in the terminal; each needs `MONGO_URI` for the `_test` database and the admin login, so source the test environment first. `scripts/demo-race.sh` starts a test-mode server on port 5051 (`PORT` overrides), runs the chosen script and stops the server:

```bash
source config/test-env.sh
npm run demo:race -- promo        # node scripts/promo-race.js
npm run demo:race -- ticket       # node scripts/ticket-race-check.js
npm run demo:race -- dispute      # node scripts/dispute-race-check.js
npm run demo:race -- inspection   # node scripts/inspection-race-check.js
npm run demo:race -- lock         # node scripts/lock-race-check.js
npm run demo:race -- all          # all five
```

Or, with your own test-mode server already running (`NODE_ENV=test`, same `MONGO_URI`, `PORT`): `node scripts/promo-race.js`, `node scripts/ticket-race-check.js`, `node scripts/dispute-race-check.js`, `node scripts/inspection-race-check.js`, `node scripts/lock-race-check.js`. They print counts only and exit non-zero on any violation.

## Endpoints

All paths are under `/api/v1`. "Own" means the owner of the booking/ticket; admins can access any.

| Area | Method and path | Who |
| --- | --- | --- |
| Auth | `POST /auth/register` | anyone |
| Auth | `POST /auth/login` (10 per minute per IP) | anyone |
| Auth | `GET /auth/me` | logged in |
| Auth | `POST /auth/logout` (revokes the token) | logged in |
| Providers | `GET /providers`, `GET /providers/:id` | anyone |
| Providers | `POST /providers`, `PUT /providers/:id`, `DELETE /providers/:id` | admin |
| Bookings | `POST /providers/:providerId/bookings` | logged in (max 3 for a user) |
| Bookings | `GET /bookings` | user: own; admin: all, paginated |
| Bookings | `GET /bookings/:id`, `PUT /bookings/:id`, `DELETE /bookings/:id` | own or admin |
| Promos | `POST /promos`, `GET /promos` | admin |
| Promos | `POST /bookings/:id/promo` (body `{code}`) | own or admin |
| Audit | `GET /audit` (filters `admin`, `booking`, `from`, `to`, `page`, `limit`) | admin; read-only |
| Tickets | `POST /tickets`, `GET /tickets`, `GET /tickets/:id`, `POST /tickets/:id/comments` | own or admin |
| Tickets | `PUT /tickets/:id/status` | admin |
| Inspections | `POST /bookings/:id/inspection` | admin |
| Inspections | `GET /bookings/:id/inspection` | own or admin |
| Inspections | `POST /bookings/:id/inspection/dispute` | booking owner only |
| Inspections | `PUT /bookings/:id/inspection/dispute` (resolved or dismissed) | admin |
| Statistics | `GET /stats?from=&to=` | admin |

## Design decisions (you may overrule these)

- Admins are exempt from the 3-booking limit; regular users can hold at most 3.
- Booking price = the provider's `dailyRate` x number of days (at least one day; `returnDate` may equal `date`).
- Late fee: the anchor is the **end of the return date in UTC** (23:59:59.999Z). Late hours are rounded up and the fee is `lateHours x lateFeePerHour`.
- A locked account answers the same `401 Invalid credentials` as a wrong password, so emails cannot be discovered through the lockout.
- Resolving a dispute records a decision and does **not** adjust the fee.
- Deleting a provider that has bookings is refused with 409.
- Deleting a booking does not release its promo redemption.
- Audit entries are written **before** the mutation; an admin's PUT that changes nothing is logged as a view. A failed mutation adds a new `failed` entry (entries are never edited).
- Dispute window: 7 days from the inspection record.

## Not implemented

- Adjusting the late fee after a dispute is resolved.
- The Extra Credit item (pending the lecturer).

## Known limits (measured in this build)

- The statistics report is linear in the number of bookings in the requested range. Measured by the team on this build against an Atlas M0 free-tier cluster with synthetic data (40 providers, bookings spread over three years): 1 day 44 ms, 1 month 115 ms, 1 year 892 ms, 2 years 1.6 s, and 2.26 s for 1,000,000 bookings in one range, about 2.25 microseconds per booking. Extrapolating, the 3 s bound would be crossed at roughly 1.3 million bookings in a single range. The test suite (`scripts/stats-index-check.js`) checks 100,000 bookings over three years (about 0.9 s). A paid cluster or a local `mongod` will differ.
- List endpoints compute `total` with `countDocuments`, which is linear on unselective filters.
- The in-process comment timestamp ordering guarantee holds per server process only.
- There are no database transactions: a process crash in the middle of applying a promo can leave a claimed booking or a redemption count behind.

## Documents

The course documents describe the whole API (the Assignment 7 class code as modified here, plus the added capabilities). Compare with the class code using `git diff c617bb6 main --stat`:

- [docs/requirements.md](docs/requirements.md): the requirements, the endpoint that satisfies each and how it is verified, the interpretations and what is not implemented.
- [docs/use-cases.md](docs/use-cases.md): actors, a use-case diagram and a use-case catalogue with the exact error flows.
- [docs/sequence-diagrams.md](docs/sequence-diagrams.md): one sequence diagram per added capability.
- [docs/uml-profile-for-api.md](docs/uml-profile-for-api.md): the UML profile for the API (every endpoint with access, request, responses) and a class diagram of the resources.
- [docs/architecture.md](docs/architecture.md): layers, request lifecycle, where each rule lives and the design decisions behind it.
- [docs/api-examples.md](docs/api-examples.md): curl walk-through of every main flow.
- [docs/testing.md](docs/testing.md): the four test levels and how to add a test.
- [docs/deployment.md](docs/deployment.md): configuration, Docker, MongoDB options, proxy and production notes.
- [CONTRIBUTING.md](CONTRIBUTING.md): workflow, commit style and how to add an endpoint.
- [docs/work-division.md](docs/work-division.md): a template the team fills in with who wrote which code and documents.
- [docs/diagrams/](docs/diagrams/): large PNG and SVG versions of the presentation diagrams (use cases, UML profile class diagrams, sequence diagrams); amber marks what was modified from the class code, teal what is new.

## Repository layout

```
server.js            app setup, route mounting, admin and provider seeding
config/              db.js, lockConfig.js, config.env.example (config.env and test-env.sh are git-ignored)
models/              Mongoose schemas (User, Provider, Booking, PromoCode, PromoRedemption, AuditLog, Ticket, Inspection, RevokedToken)
controllers/         request handlers per area
routes/              Express routers per area
middleware/          auth (protect, authorize) and the login limiter
utils/               pricing and paging helpers
scripts/             run-newman.sh (npm test), demo-race.sh, seeds, race and index checks, collection-check.js
__tests__/           rental.postman_collection.json (+ environment) = test suite; demo.postman_collection.json (+ environment) = presentation demo
docs/                requirements.md, use-cases.md, sequence-diagrams.md, uml-profile-for-api.md, work-division.md
docs/plans/          implementation plan
spec.md              requirements
```

## Troubleshooting

- **Cannot connect / server times out (Atlas):** add your current IP in Network Access, and check the user and password in `MONGO_URI`.
- **`MONGO_URI is not set`:** run `source config/test-env.sh` in the same terminal before `npm test` or `npm run demo:race`.
- **`Refusing to run: the database name in MONGO_URI must end with _test`:** the guard did its job; use `config/test-env.sh`, never your development string, for tests.
- **`adminEmail and adminPassword must be set`:** the same `source config/test-env.sh` (or export them yourself).
- **Port already in use (`EADDRINUSE`):** another server holds the port; stop it or set another `PORT` (the demo command line then needs a matching `baseUrl`).
- **429 during a demo:** the login limiter counts every login request per IP per minute. Wait 60 seconds and run again, or run the demo against a `NODE_ENV=test` server where the limiter is off.
