# Work Division

Rental Car Booking REST API (Project #7), course 2110336 SW Dev Practice, Chulalongkorn University.

## Scope

This document is a TEMPLATE for the team to complete honestly. It describes the division of work for the WHOLE API, because the modified class code (Assignment 7) and the added capabilities form one API.

> **Modified from the class code (Assignment 7, VacQ).** The starting point is the Assignment 7 source exactly as received, commit `c617bb6` ("base: Assignment 7 source as received"). See what differs with `git diff c617bb6 main --stat`. In short: Hospital and Appointment became Provider and Booking; the A7 auth code was modified (the role is no longer chosen by the client, one `401` for every login failure, logout with token revocation, account lockout and a per-IP limit, no hard-coded seed password); and promo codes, the audit log, support tickets, return inspections and statistics were added.

Related documents: [requirements](requirements.md), [use cases](use-cases.md), [sequence diagrams](sequence-diagrams.md), [UML profile for API](uml-profile-for-api.md).

## Team

| | Name | Student ID |
| --- | --- | --- |
| Student 1 | Piranat Wadlom (พีรณัฐ แวดล้อม) | 6732031621 |
| Student 2 | `[FILL IN: name of the second student]` | `[FILL IN: student ID]` |

## Why this is a template

The Term Project slide says that each student must write code AND documents, and that grading is proportional to each person's actual contribution (a student who only writes documents earns at most about 5%). Only the team knows who wrote what, so this file does not state it. The first two columns of the table below come from the repository; the last two columns are left empty on purpose.

## Responsibilities table

For each row, write in the last two columns the name of the student who wrote the code and the name of the student who wrote the documents, and name specific files or commits where you can. If both of you worked on a row, say what each of you did.

| Area | Folder or file | What it does | Code written by | Documents written by |
| --- | --- | --- | --- | --- |
| Auth and login protection | `routes/auth.js`, `controllers/auth.js`, `middleware/auth.js`, `middleware/loginLimiter.js`, `models/User.js`, `models/RevokedToken.js`, `config/lockConfig.js` | register, login, logout, token revocation, account lockout, 10 requests per minute per IP limiter | | |
| Providers and bookings | `routes/providers.js`, `routes/bookings.js`, `controllers/providers.js`, `controllers/bookings.js`, `models/Provider.js`, `models/Booking.js`, `utils/pricing.js`, `utils/paging.js` | provider CRUD, booking create, view, edit and delete, 3-booking limit, pricing | | |
| Promo codes | `routes/promos.js`, `controllers/promos.js`, `models/PromoCode.js`, `models/PromoRedemption.js` | promo creation and the atomic apply with undo | | |
| Audit log | `routes/audit.js`, `controllers/audit.js`, `models/AuditLog.js` | append-only admin audit entries and the read-only query | | |
| Support tickets | `routes/tickets.js`, `controllers/tickets.js`, `models/Ticket.js` | tickets, comments, status | | |
| Inspection and disputes | `routes/inspections.js`, `controllers/inspections.js`, `models/Inspection.js` | return inspection, late fee, dispute and its resolution | | |
| Statistics | `routes/stats.js`, `controllers/stats.js` | admin statistics report by one aggregation | | |
| Tests and Postman collections | `__tests__/rental.postman_collection.json`, `__tests__/rental.postman_environment.json`, `scripts/` (`run-newman.sh`, seeds, race and index checks) | the automated suite run by `npm test` | | |
| Demo | `__tests__/demo.postman_collection.json`, `__tests__/demo.postman_environment.json`, `scripts/demo-race.sh` | the 7-minute presentation demo | | |
| Documents | `docs/requirements.md`, `docs/use-cases.md`, `docs/sequence-diagrams.md`, `docs/uml-profile-for-api.md`, `docs/work-division.md`, `README.md`, `spec.md` | the documents the slide asks for | | |

Other items the slide asks the team to present, to be completed by the team:

| Item | Link or note |
| --- | --- |
| Link to the Extra Credit video | `[FILL IN: link, once the lecturer has defined the Extra Credit item]` |
| Link to the GitHub project | `[FILL IN: link]` |

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

`[FILL IN: how the AI agent was used, and what each student did personally]`
