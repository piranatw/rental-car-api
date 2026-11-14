# Spec: Project #7 — Rental Car Booking API (with additional requirements)

Author: Piranat Wadlom (6732031621)
Sources: `SW_Dev_Projects(2)-336264-17392597504461.pdf` (project listing, NFRs, constraints), the Term Project rules slide (item 17), and the additional requirements supplied by the user.

## Problem Statement

A rental car customer has no way to reserve cars from a rental provider through a service, and the rental operator (admin) has no way to manage those reservations safely. Customers need to register, log in, browse rental car providers and book cars. Admins need to oversee every booking, and the operator needs the controls a real rental business expects:

- Discount promotions that cannot be over-redeemed.
- A tamper-proof record of what admins did to bookings.
- Protection of accounts against password guessing.
- A support channel tied to bookings.
- A vehicle return inspection with automatic late fees and a dispute path.
- Statistics for the business.

The deliverable is a backend-only REST API that the team demonstrates entirely through Postman (Runner or Newman). No frontend is built.

## Solution

A REST web API backed by MongoDB Atlas or PostgreSQL that provides:

1. The base Project #7 flow: register, log in and out, list providers, book up to 3 cars, and view, edit and delete bookings. Admins can view, edit and delete any booking.
2. Six additional capabilities layered on top:
   - A. Promotion codes
   - B. Admin audit log
   - C. Login brute-force protection
   - D. Support tickets
   - E. Return inspection, late fee and dispute
   - F. Statistics report
3. A Postman collection, runnable by Postman Runner or Newman, that proves every requirement including failure paths.

## User Stories

### Account and session

1. As a visitor, I want to register with name, telephone number, email and password, so that I become a registered user.
2. As a visitor, I want registration to be rejected when the email is already registered, so that accounts stay unique.
3. As a registered user, I want to log in with email and password, so that I can use the system.
4. As a registered user, I want to log out, so that my session can no longer be used.
5. As a registered user, I want a logged-out token to be rejected afterwards, so that a stolen or old token is useless.
6. As a registered user, I want my password never returned by any API, so that my credentials stay confidential.
7. As a registered user, I want my bookings and personal data visible only to me and to admins, so that my transactions stay confidential.

### Providers

8. As a registered user, I want to list rental car providers with name, address and telephone number, so that I can choose where to rent.
9. As an admin, I want each provider to carry a late fee per hour, so that late-return fees can be computed.
10. As an admin, I want to create, edit and delete providers, so that the provider list stays current.

### Bookings (base requirements)

11. As a registered user, I want to book a car by specifying a date and a provider, so that my reservation is recorded.
12. As a registered user, I want to hold at most 3 bookings, so that the booking limit is enforced; a 4th is rejected with a clear error.
13. As a registered user, I want to view only my own bookings, so that I can track them.
14. As a registered user, I want to edit my own booking, so that I can change the date or provider.
15. As a registered user, I want to delete my own booking, so that I can cancel it.
16. As a registered user, I want to be blocked from viewing, editing or deleting another user's booking, so that bookings remain private.
17. As an admin, I want to view any booking, so that I can supervise reservations.
18. As an admin, I want to edit any booking, so that I can correct problems.
19. As an admin, I want to delete any booking, so that I can remove invalid reservations.
20. As a non-authenticated caller, I want protected endpoints to reject me, so that only logged-in users act.

### A. Promotion codes

21. As an admin, I want to create a promotion code with a code string, a discount type (percentage or fixed amount), a validity period, a maximum total number of redemptions and an optional per-user limit, so that I can run campaigns.
22. As an admin, I want invalid promo definitions rejected (for example percentage over 100, negative amounts, end before start), so that bad campaigns cannot be created.
23. As a registered user, I want to apply one promotion code to a booking, so that I get a discount.
24. As a registered user, I want the discount applied to the booking's total price, so that I pay less.
25. As a registered user, I want to be told specifically that a code is expired, not yet valid, unknown, exhausted, or past my per-user limit, so that I understand why it failed.
26. As a registered user, I want to be blocked from applying a second code to the same booking, so that discounts do not stack.
27. As an operator, I want the redemption count incremented atomically, so that concurrent requests can never exceed the maximum total redemptions.
28. As an operator, I want a rejected application to leave the redemption count and booking price unchanged, so that failures have no side effects.
29. As a non-admin user, I want to be rejected when I try to create a promo code, so that only admins manage promotions.

### B. Admin audit log

30. As an operator, I want an audit entry written every time an admin views a booking, so that access to customer data is traceable.
31. As an operator, I want an audit entry written every time an admin edits a booking, containing before and after values of the changed fields, so that every change is reconstructable.
32. As an operator, I want an audit entry written every time an admin deletes a booking, containing the deleted values, so that deletions are traceable.
33. As an operator, I want each entry to contain admin ID, action, target booking ID and timestamp, so that who did what and when is clear.
34. As an admin, I want to query the audit log filtered by admin, by booking or by date range, so that I can investigate.
35. As an admin, I want audit results paginated and each page returned within 3 seconds, so that large logs stay usable.
36. As an operator, I want no API to modify or delete audit entries, so that the log is immutable.
37. As a non-admin user, I want audit log queries rejected, so that the log stays private.

### C. Login brute-force protection

38. As an operator, I want an account locked for 15 minutes after 5 consecutive failed logins, so that password guessing is stopped.
39. As an operator, I want a locked account to refuse login even with the correct password until the lock expires, so that the lock is meaningful.
40. As a registered user, I want the failed-attempt counter reset after a successful login, so that occasional typos do not accumulate.
41. As an operator, I want login limited to 10 requests per minute per IP address, so that distributed guessing against one source is throttled.
42. As a client, I want HTTP 429 with a retry-after time when the limit is exceeded, so that I know when to retry.
43. As an operator, I want a wrong password and a non-existent email to return the same generic error message, so that registered emails cannot be discovered.

### D. Support tickets

44. As a registered user, I want to create a support ticket linked to one of my own bookings, with a category (billing, vehicle issue or other), a subject and a description, so that I can get help.
45. As a registered user, I want ticket creation rejected for a booking that is not mine, so that tickets cannot be linked to others' bookings.
46. As a registered user, I want to view my own tickets with their status (open, in progress, resolved), so that I can follow progress.
47. As a registered user, I want to add follow-up comments to my ticket until it is resolved, so that I can add information.
48. As an admin, I want to view all tickets, so that I can see every request.
49. As an admin, I want to filter tickets by status or category, so that I can prioritise.
50. As an admin, I want to reply to a ticket, so that I can help the user.
51. As an admin, I want to change a ticket's status, so that progress is visible to the user.
52. As an operator, I want every comment to record its author and timestamp, so that the conversation is traceable.
53. As an operator, I want new comments on resolved tickets rejected, so that closed tickets stay closed.
54. As a registered user, I want to be blocked from viewing other users' tickets, so that support content stays private.

### E. Return inspection, late fee and dispute

55. As an admin, I want to record a return inspection for a booking with actual return time, odometer reading, fuel level and damage notes, so that the vehicle's condition is documented.
56. As an operator, I want the late-return fee calculated automatically by rounding overdue time up to whole hours and multiplying by the provider's late fee per hour, so that fees are consistent.
57. As an operator, I want no late fee when the car is returned on time or early, so that users are not overcharged.
58. As a registered user, I want to view the inspection report of my own booking, so that I can see what was recorded and charged.
59. As a registered user, I want to be blocked from viewing inspection reports of other users' bookings, so that reports stay private.
60. As a registered user, I want to submit one dispute comment within 7 days of the inspection, so that I can contest it.
61. As a registered user, I want a second dispute or one after 7 days rejected with a specific message, so that the rule is clear.
62. As an admin, I want to resolve a dispute, so that valid complaints are honoured.
63. As an admin, I want to dismiss a dispute, so that invalid complaints are closed.

### F. Statistics report

64. As an admin, I want to view a statistics report within a selected date range, so that I can understand business performance.
65. As an admin, I want the total number of bookings in the range, so that I see overall volume.
66. As an admin, I want the number of bookings per provider, so that I compare providers.
67. As an admin, I want the number of bookings per month, so that I see trends.
68. As an admin, I want the top 5 most booked providers, so that I identify the leaders.
69. As an operator, I want all figures aggregated in the database and returned within 3 seconds, so that reports are fast.
70. As a non-admin user, I want the request rejected with HTTP 403, so that statistics stay private.

### Course deliverables and demo

71. As a grader, I want a Postman collection runnable with Postman Runner or Newman that proves each requirement including failure paths, so that I can verify the system without a frontend.
72. As a grader, I want to see the code each student wrote and the documents each student wrote, so that individual contribution is assessable.
73. As a presenter, I want to present within 7 minutes and take questions for up to 3 minutes, so that I meet the time limit.

## Implementation Decisions

### Global constraints (from the project listing)

- Web API only, REST, backend only. The database is MongoDB Atlas or PostgreSQL (team picks one).
- Authentication is email and password. User transactions are confidential: users reach only their own data, admins reach all.
- Every request must respond within 3 seconds. The system must be usable and testable through Postman.

### Domain terms

- **Registered user**: someone who has registered; a role of `user`.
- **Admin**: a role with access to any booking, audit log, tickets, inspections, disputes, promotions and statistics.
- **Provider**: a rental car provider with name, address, telephone and late fee per hour.
- **Booking**: a user's reservation of a car at a provider on a date. It carries a total price and, when applied, a promo code and discount.

### Modules and interfaces

- **Auth**: register, login, logout, current-user lookup.
  - Logout must invalidate the token server-side, so a replayed token returns 401. Use a token denylist with a TTL equal to the token's remaining lifetime, or server-side sessions.
  - Auth middleware resolves the caller and role for every protected route.
- **Provider**: list for registered users, with admin create, edit and delete. The provider carries `lateFeePerHour`.
- **Booking**:
  - Create, list own, list all (admin), view, edit, delete.
  - The 3-booking limit is checked per user at creation. Ownership is enforced on every user-scoped operation.
  - Total price is stored on the booking. The pricing source (provider daily rate or similar) is a decision the team must fix; the spec requires only that a total price exists to discount.
- **Promotion**:
  - Admin create (code, type percentage or fixed, validity start and end, max total redemptions, optional per-user limit). Admin list is an optional convenience.
  - User apply-to-booking applies one code per booking.
  - Validation order and error messages are specific and distinct: unknown, not yet valid, expired, exhausted, per-user limit reached, already has a code.
  - Redemption increments via a single atomic conditional update (increment only if count is below the max) in the database, so concurrent requests cannot exceed the limit. Per-user usage is recorded per redemption.
  - A failed application changes nothing.
  - The discount type either takes a percentage off the total or subtracts a fixed amount. The final total never goes below zero.
- **Audit log**:
  - Append-only collection or table. An entry holds admin ID, action (view, edit or delete), target booking ID, timestamp and before/after values of changed fields. Deletes record the removed values.
  - Entries are written by the booking module whenever an admin views, edits or deletes a booking.
  - Query API filters by admin, booking and date range with pagination, indexed so each page returns within 3 seconds.
  - There is no update or delete route, and the persistence layer exposes no mutating path for audit entries.
- **Login protection**:
  - Account lockout: 5 consecutive failures lock the account for 15 minutes. The counter resets on success.
  - IP rate limit: 10 login requests per minute per IP. Excess returns HTTP 429 with a retry-after time (also as a `Retry-After` header).
  - Wrong password and unknown email return the identical generic error body and status.
  - Counters and lock state must be stored in shared persistent storage, not process memory, so they survive restarts and multiple instances.
  - Lock duration is configurable via environment (default 15 minutes), so the demo can shorten it. The presentation states the real value.
- **Support tickets**:
  - Ticket: booking reference (must belong to the creator), category (billing, vehicle issue, other), subject, description and status (open, in progress, resolved).
  - Comments hold author, role and timestamp.
  - Users see and comment only on their own tickets. Admins list all, filter by status or category, reply and change status. Comments are rejected once the ticket is resolved.
- **Inspection and dispute**:
  - Admin records an inspection per booking: actual return time, odometer, fuel level and damage notes.
  - Late fee = ceil(overdue hours) × provider `lateFeePerHour`, with overdue measured against the booking's scheduled return time. The fee is zero when not overdue. It is computed server-side and stored on the inspection.
  - The owner views the inspection report of their own booking. The owner can submit exactly one dispute comment within 7 days of the inspection record. The admin resolves or dismisses it.
  - The scheduled return time field on the booking is a schema decision the team must make, as the base spec books by date only.
- **Statistics**: admin only, with a date range input. Returns total bookings, bookings per provider, bookings per month and the top 5 providers. All figures come from database aggregation, not application-side loops. Non-admin callers receive HTTP 403.

### Schema changes (conceptual)

- User: name, telephone, email (unique), password hash, role, failed-attempt count, lock-until.
- Provider: name, address, telephone, late fee per hour.
- Booking: user, provider, date, total price, applied promo, discount, scheduled return time.
- PromoCode: code (unique), type, value, valid-from, valid-to, max redemptions, redemption count, optional per-user limit. A redemption record links user, code and booking.
- AuditLog: admin, action, booking, timestamp, before and after.
- Ticket and TicketComment, Inspection and Dispute as described above.
- Token denylist or session store, and rate-limit counters.

### API contract rules

- JSON requests and responses. Consistent status codes: 401 unauthenticated, 403 forbidden, 404 not found, 400 or 409 validation and conflict, 429 rate limit.
- Error bodies carry a specific, stable message for promo failures and the generic message for login failures.

## Testing Decisions

- **What makes a good test**: it drives the system only through its REST API and asserts status codes, response bodies and visible state. It does not look at internals.
- **Proposed seam (one)**: the HTTP API boundary. Every requirement is exercised via Postman requests, with each folder asserting its behaviour.
  - *Please confirm or correct this seam before implementation.*
- **Collection structure**:
  - Auth: register, duplicate email, login, token reuse after logout (401), wrong password and unknown email return identical messages, 5 failures then lockout, counter reset, 11 requests in a minute return 429 with retry-after.
  - Bookings: create, 4th booking rejected, own-only view, edit and delete, admin view, edit and delete of any booking, access without a token.
  - Promo: create, apply, expired, exhausted, per-user limit, second code rejected, non-admin create rejected, concurrent applications never exceed the max (Runner parallel iterations or a small concurrent script).
  - Audit: entries created on admin view, edit and delete with before and after, filters and pagination, no mutating route exists, non-admin rejected.
  - Tickets: create for own and other's booking, comment, resolve, comment on resolved rejected, admin filters, reply and status change.
  - Inspection: on-time, 1 minute late, exactly N hours late and N hours plus a minute late for fee rounding, owner-only report, dispute once, dispute after 7 days rejected, admin resolve and dismiss.
  - Stats: totals, per provider, per month, top 5, empty range, non-admin 403.
  - Performance: audit page and stats responses within 3 seconds on seeded data.
- **Runner**: the collection must run unattended in Postman Runner or Newman. Newman is the CI-style and report path.
- **Prior art**: none in this repo (it is empty). The base class code the course teaches is the starting point and is not present here yet.

## Out of Scope

- Any frontend or UI.
- Payment processing and real money movement.
- Email or SMS notifications.
- Car inventory and availability beyond the 3-booking-per-user rule, unless the team chooses to add it.
- Other projects in the listing (#1–#6, #8).
- Multi-factor authentication, password reset and email verification.
- The slide's "Extra Credits" feature itself, which the slide mentions without defining; see Further Notes.

## Further Notes

### Term Project rules (slide item 17)

- A topic is assigned randomly by the lecturer in week 5. This team's topic is Project #7. The work is done in pairs.
- The project is a modification of the program code taught in class so that it meets the assigned requirements.
- **Each student must write code and also write documents (diagrams).** Grading is proportional to each person's actual contribution. A student who only writes documents earns at most about 5%.
- Final presentation is in the last week of classes: at most 7 minutes, then at most 3 minutes of Q&A.

### What the presentation must cover

1. The requirements received (Project #7 plus the additional requirements).
2. A demonstration that the program works to those requirements, run with **Postman Runner or Newman**.
3. The code that was modified from the original class code.
4. Documents: Requirements, Use Cases, Sequence Diagram and UML Profile for API. These explain only the parts changed from the original; no diagrams are needed for Extra Credits.
5. How the work was divided within the team.
6. A link to the **Extra Credit VDO**, which teaches viewers how to build the extra feature.
7. A link to the project's GitHub.

### Open questions for the team

- **Extra Credit**: the slide names Extra Credits without defining them. Confirm with the lecturer whether the additional requirements (A–F) are the extra credit, or whether it is separate, as that determines what the VDO covers.
- **Pricing and return time**: the base requirements say a booking has a date and a provider only. The promo discount needs a total price, and the late fee needs a scheduled return time. Decide the source of each (for example a provider daily rate, and a booking start and end).
- **Seven minutes is tight** for the base plus six additions. Plan to run the full Newman collection once, explain two or three of the more interesting cases (atomic promo redemption, audit log immutability, lockout and rate limit), and leave the rest to the documents and the VDO.
- **Logout design**: stateless tokens do not invalidate on logout by themselves. A denylist or server-side sessions are needed to meet "a logged-out token is rejected".
- **Work division**: split so that each of the two students has both code and documents, with commit history on GitHub showing each person's contribution.
