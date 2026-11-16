# Work Division

Rental Car Booking REST API (Project #7), course 2110336 SW Dev Practice, Chulalongkorn University.

## Scope

This document records who did what, taken from the git history (`git shortlog -sne --all`: 24 commits by Piranat, 13 by Kritarat at the time of writing). It describes the division of work for the WHOLE API, because this repository was built as a fresh project and not as a patch on the class code.

> **Team to fill in:** Mark here which parts differ from the class (Hospital/Appointment) code, as the slide requires; only the team knows that.

Related documents: [requirements](requirements.md), [use cases](use-cases.md), [sequence diagrams](sequence-diagrams.md), [UML profile for API](uml-profile-for-api.md).

## Team

| | Name | Student ID |
| --- | --- | --- |
| Student 1 | Piranat Wadlom (พีรณัฐ แวดล้อม) | 6732031621 |
| Student 2 | Kritarat Moonmanee (กฤตรัฐ มูลมณี) | 6732001821 |

## How to read this

The Term Project slide says each student must write code and documents, and grading follows each person's actual contribution. The table below names who wrote the code and who wrote the documents for each area. It is checked against the git history with the commands at the end of this file.

## Responsibilities table

| Area | Folder or file | What it does | Code written by | Documents written by |
| --- | --- | --- | --- | --- |
| Auth and login protection | `routes/auth.js`, `controllers/auth.js`, `middleware/auth.js`, `middleware/loginLimiter.js`, `models/User.js`, `models/RevokedToken.js`, `config/lockConfig.js` | register, login, logout, token revocation, account lockout, 10 requests per minute per IP limiter | Piranat | Piranat |
| Providers and bookings | `routes/providers.js`, `routes/bookings.js`, `controllers/providers.js`, `controllers/bookings.js`, `models/Provider.js`, `models/Booking.js`, `utils/pricing.js`, `utils/paging.js` | provider CRUD, booking create, view, edit and delete, 3-booking limit, pricing | Piranat | Piranat |
| Promo codes | `routes/promos.js`, `controllers/promos.js`, `models/PromoCode.js`, `models/PromoRedemption.js` | promo creation and the atomic apply with undo | Piranat | Piranat |
| Audit log | `routes/audit.js`, `controllers/audit.js`, `models/AuditLog.js` | append-only admin audit entries and the read-only query | Piranat | Piranat |
| Support tickets | `routes/tickets.js`, `controllers/tickets.js`, `models/Ticket.js` | tickets, comments, status | Piranat | Piranat |
| Inspection and disputes | `routes/inspections.js`, `controllers/inspections.js`, `models/Inspection.js` | return inspection, late fee, dispute and its resolution | Piranat | Piranat |
| Statistics | `routes/stats.js`, `controllers/stats.js` | admin statistics report by one aggregation | Piranat | Piranat |
| Tests and Postman collections | `__tests__/rental.postman_collection.json`, `__tests__/rental.postman_environment.json`, `scripts/` (`run-newman.sh`, seeds, race and index checks) | the automated suite run by `npm test` | Piranat (Postman suite, scripts). Kritarat: added cases for promo and provider validation and auth | Piranat |
| Demo | `__tests__/demo.postman_collection.json`, `__tests__/demo.postman_environment.json`, `scripts/demo-race.sh` | the 7-minute presentation demo | Piranat (collection, environment) | Piranat (README notes); Kritarat (presenter script, later removed) |
| Documents | `docs/requirements.md`, `docs/use-cases.md`, `docs/sequence-diagrams.md`, `docs/uml-profile-for-api.md`, `docs/work-division.md`, `README.md`, `spec.md` | the documents the slide asks for | n/a (documents only) | Piranat (requirements, use cases, sequences, UML profile, work division) |
| API documentation | `openapi.yaml`, `/api-docs` in `server.js`, `docs/architecture.md`, `docs/testing.md`, `docs/deployment.md`, `docs/api-examples.md`, `CONTRIBUTING.md` | OpenAPI 3 spec with Swagger UI and the supporting guides | Kritarat | Kritarat |
| Unit tests | `__tests__/unit/` (pricing, paging, openapi, lockConfig, authMiddleware, loginLimiter, models, serverHeaders, errorHandling) | 99 `node:test` tests, run by `npm run test:unit` | Kritarat | Kritarat |
| Robustness suite | `__tests__/robustness.postman_collection.json`, `scripts/run-robustness.sh` | 224 Newman requests for malformed input, injection, odd ids, pagination, headers | Kritarat | Kritarat |
| CI, Docker, error handling | `.github/workflows/ci.yml`, `Dockerfile`, `docker-compose.yml`, helmet and JSON 404/400/413 handlers in `server.js` | automated checks, container setup, security headers, JSON error responses | Kritarat | Kritarat |

Other items the slide asks the team to present:

| Item | Link or note |
| --- | --- |
| Link to the Extra Credit video | `[FILL IN: link, once the video is recorded]` |
| Link to the GitHub project | https://github.com/piranatw/rental-car-api |

## How to show each person's contribution

The instructor grades individual contribution, so the table above and the git history must agree. Run these from the repository root and compare their output with the table:

```bash
git shortlog -sne --all
git log --author="<name or email>" --stat
git blame <file>
```

- `git shortlog -sne --all` counts commits per author across all branches.
- `git log --author="<name or email>" --stat` lists one person's commits with the files each one touched.
- `git blame <file>` (for example `git blame controllers/promos.js`) shows who wrote each line of a file.

Make sure each person commits under their own name and email (`git config user.name`, `git config user.email`). If a row of the table says a person wrote something, the history should show it.

## A note on how this repository was produced

The history of this repository was produced with AI-agent assistance. The team must describe truthfully how it used that assistance and what each of you personally did (what you wrote, reviewed, ran, tested or changed yourself, and what you can explain). Do not claim work that the history and your own understanding of the code do not support. Write that description here:

Kritarat Moonmanee: the additions listed under his name (OpenAPI spec and API docs, unit tests, robustness suite, CI and Docker, helmet and JSON error handlers, extra Postman cases, README and guides) were written with an AI coding assistant. He chose the scope, ran the test suites against a local database and reviewed the results. He found and fixed the flaky promo test in P's Postman collection (the date was read twice per request).

Piranat Wadlom: `[FILL IN by Piranat: how the AI agent was used for the original API, tests and documents, and what he did personally]`
