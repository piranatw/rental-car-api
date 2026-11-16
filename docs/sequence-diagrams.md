# Sequence Diagrams

Rental Car Booking REST API (Project #7), course 2110336 SW Dev Practice.

## Scope

This document describes the WHOLE API, because the modified class code (Assignment 7) and the added capabilities form one API. There is one diagram per added capability. Every status code and message below is taken from `controllers/` and `middleware/`.

> **Modified from the class code (Assignment 7, VacQ).** The starting point is the Assignment 7 source exactly as received, commit `c617bb6` ("base: Assignment 7 source as received"). See what differs with `git diff c617bb6 main --stat`. In short: Hospital and Appointment became Provider and Booking; the A7 auth code was modified (the role is no longer chosen by the client, one `401` for every login failure, logout with token revocation, account lockout and a per-IP limit, no hard-coded seed password); and promo codes, the audit log, support tickets, return inspections and statistics were added.

Related documents: [requirements](requirements.md), [use cases](use-cases.md), [UML profile for API](uml-profile-for-api.md), [work division](work-division.md).

Reading notes: the API answers every error with `success false` and a `message`. A `401 Not authorized to access this route` is the answer of the `protect` middleware (no header, bad token, revoked token, or deleted user). A non-admin on an admin route gets `403 User role user is not authorized to access this route`.

## 1. Register, login and logout with token revocation

Register stores a new user (the role is always `user`) and returns a signed JWT. Login returns a token with a unique id inside, so two logins give two different tokens. Logout stores the SHA-256 hash of the token in the `RevokedToken` collection with a TTL equal to the token's own expiry. The `protect` middleware checks that collection on every request, so a replay of a logged-out token gets the same 401 as a forged token.

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant U as Users collection
    participant R as RevokedTokens collection
    C->>A: POST /auth/register name, telephone, email, password
    A->>U: create user with role user, password hashed
    alt email already stored
        U-->>A: duplicate key
        A-->>C: 400 Email already registered
    else created
        U-->>A: user
        A-->>C: 201 token and data id, name, email, telephone, role
    end
    C->>A: POST /auth/login email, password
    Note over A,U: loginLimiter and the lockout run first, see diagram 2
    A->>U: reserve attempt, compare password
    U-->>A: user
    A-->>C: 200 token and data id, name, email, telephone, role
    C->>A: GET /auth/me with Authorization Bearer jwt
    A->>R: is the token hash revoked
    R-->>A: no
    A->>U: find user by token id
    A-->>C: 200 data without password
    C->>A: POST /auth/logout with Authorization Bearer jwt
    A->>R: upsert sha256 of token, expiresAt equals token exp
    A-->>C: 200 success true, data empty
    C->>A: GET /auth/me with the same jwt
    A->>R: is the token hash revoked
    R-->>A: yes
    A-->>C: 401 Not authorized to access this route
```

## 2. Login protection: lockout and the IP rate limit

Two independent defences. First the `loginLimiter` middleware counts every login request per client IP (10 per minute, whatever the outcome) and answers 429 with a `Retry-After` header before the controller runs. Second, inside the controller, one atomic update reserves the attempt on the user document BEFORE the password is compared: it adds one to the counter and, when the counter reaches the limit (5 by default, `LOGIN_MAX_ATTEMPTS`), sets `lockUntil` to now plus 15 minutes (`LOGIN_LOCK_MINUTES`) in the same update. Concurrent logins are serialised by the database, so parallel guesses cannot get more than 5 real password checks per lock window. Wrong password, unknown email and a locked account all give the identical `401 Invalid credentials` and each costs one write and one bcrypt compare, so neither the body nor the timing shows which case happened. A correct password resets the counter.

```mermaid
sequenceDiagram
    participant C as Client
    participant L as loginLimiter
    participant A as Auth controller
    participant U as Users collection
    C->>L: POST /auth/login
    alt more than 10 requests this minute from this IP
        L-->>C: 429 Too many login attempts from this IP, please try again later, Retry-After header, retryAfter seconds
    else within the budget
        L->>A: next
        A->>U: one atomic update, counter plus 1, lock when the counter reaches 5
        U-->>A: user as it was before the update
        alt unknown email or account already locked or attempt budget used up
            A->>A: bcrypt compare against a dummy hash
            A-->>C: 401 Invalid credentials
        else attempt reserved
            A->>A: bcrypt compare with the stored hash
            alt wrong password
                A-->>C: 401 Invalid credentials
            else correct password
                A->>U: reset counter and unset lock only if no newer attempt was reserved
                A-->>C: 200 token and data
            end
        end
    end
    Note over A,U: 5th consecutive failure sets lockUntil to now plus 15 minutes. The correct password is refused with the same 401 until it expires
```

## 3. Apply a promo code with atomic reservation and undo

The steps are ordered so that no request can take more than its share. (a) The booking is claimed first (`promo` set only where it is still null), so a second apply on the same booking stops here. (b) The promo is reserved by ONE conditional `findOneAndUpdate`: the validity window, `redemptionCount < maxRedemptions` and the per-user usage are all in the filter and both counters are incremented in the same update. (c) A redemption record is written. (d) The booking price is finalised, pinned to the dates and provider the price was computed from, and retried up to 3 times if the booking was edited meanwhile, otherwise 409. If anything after the claim fails, the undo runs in reverse order (delete redemption, release the reservation, release the claim) and each undo step runs only once. A failed reservation releases only the claim and leaves the redemption count and the booking price as they were.

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant B as Bookings collection
    participant P as PromoCodes collection
    participant R as Redemptions collection
    C->>A: POST /bookings/:id/promo with code
    A->>B: load booking, check owner or admin
    alt booking already has a promo
        A-->>C: 400 Booking already has a promo code
    else no promo yet
        A->>P: find the code
        alt code unknown
            A-->>C: 400 Promo code not found
        else code exists
            A->>B: claim, set promo where promo is null
            alt lost the claim to a concurrent request
                A-->>C: 400 Booking already has a promo code
            else claimed
                A->>P: reserve, one atomic update, in window and count below max and user below limit, then add 1 to both counters
                alt reservation refused
                    P-->>A: no document matched
                    A->>B: undo, release the claim
                    A-->>C: 400 not yet valid or has expired or reached its maximum redemptions or per-user limit
                else reserved
                    P-->>A: updated promo
                    A->>R: create redemption for the booking owner
                    A->>B: finalise discount and totalPrice, pinned to the priced dates and provider
                    alt booking changed meanwhile for 3 attempts
                        A->>R: undo, delete redemption
                        A->>P: undo, subtract 1 from both counters
                        A->>B: undo, release the claim
                        A-->>C: 409 Booking was modified concurrently, please retry
                    else finalised
                        A-->>C: 200 booking with promo, discount and lower totalPrice
                    end
                end
            end
        end
    end
    Note over A,P: Concurrent requests cannot exceed maxRedemptions or the per-user limit, because the check and the increment are one atomic update on the promo document
    Note over A,B: An admin apply also appends an edit entry to the audit log before the claim, see diagram 4
```

The reservation-refused messages are exactly: `Promo code is not yet valid`, `Promo code has expired`, `Promo code has reached its maximum redemptions` and `You have reached the per-user limit for this promo code`, chosen by reading the promo again after the refusal. Other 400s on this route are `Please provide a promo code` and `Booking has no price to discount`.

## 4. Admin audit write, and reading the audit log

Every ADMIN view, edit and delete of a booking appends one entry to the audit log BEFORE the booking is read out or changed, so a mutation can never succeed without its record. For an edit the entry holds only the changed fields, before and after. If the mutation then does not happen, a NEW entry with status `failed` and a reason is appended; the earlier entry is never edited. A regular user's own actions write nothing. The log has no write route: `GET /audit` is the only audit route, and the Mongoose model refuses every update and delete path.

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant L as AuditLog collection
    participant B as Bookings collection
    C->>A: GET or PUT or DELETE /bookings/:id with a token
    A->>B: load booking
    alt caller is a regular user and the owner
        A->>B: read or update or delete
        A-->>C: 200 result, no audit entry
    else caller is neither owner nor admin
        A-->>C: 403 Not authorized to access this booking
    else caller is an admin
        A->>L: append entry admin, action view or edit or delete, booking, before, after
        L-->>A: recorded
        A->>B: read or update or delete the booking
        alt mutation done
            A-->>C: 200 result
        else mutation did not happen
            A->>L: append a NEW entry with status failed and a reason
            A-->>C: 404 Booking not found or 409 Booking was modified concurrently, please retry
        end
    end
    Note over A,L: PUT with no change is logged as a view. GET /bookings logs one view per returned booking
    C->>A: GET /audit with filters admin, booking, from, to, page, limit
    alt caller is not an admin
        A-->>C: 403 User role user is not authorized to access this route
    else filters invalid
        A-->>C: 400 for example from must be an ISO date
    else admin and valid
        A->>L: find newest first, skip and limit, plus a count
        L-->>A: entries
        A-->>C: 200 count, total, page, pages, data
    end
    C->>A: POST or PUT or PATCH or DELETE /audit
    A-->>C: 404 no such route, the log cannot be changed through the API
```

## 5. Ticket comment and ticket status

A comment is one atomic `$push` whose filter says the ticket is not `resolved` and still has room for another comment (at most 200). Because the rule and the write are one operation, a status change racing a comment cannot slip a comment onto a resolved ticket. When the update matches nothing, one read explains why. The comment's author and role come from the token and the time from the server clock. An admin sets the status in a separate request and can reply with the same comment route.

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant T as Tickets collection
    C->>A: POST /tickets/:id/comments with text
    A->>T: find ticket
    alt ticket missing
        A-->>C: 404 Ticket not found
    else caller is neither the ticket owner nor an admin
        A-->>C: 403 Not authorized to access this ticket
    else allowed
        A->>A: check text is 1 to 2000 characters, else 400
        A->>T: one update, push comment where status is not resolved and fewer than 200 comments
        alt update matched
            T-->>A: ticket with the new comment
            A-->>C: 200 data with author, role and createdAt from token and server clock
        else nothing matched
            A->>T: read the status
            alt status is resolved
                A-->>C: 400 Ticket is resolved
            else 200 comments already
                A-->>C: 400 Ticket has reached the maximum number of comments
            end
        end
    end
    C->>A: PUT /tickets/:id/status with status
    alt caller is not an admin
        A-->>C: 403 User role user is not authorized to access this route
    else status not open, in progress or resolved
        A-->>C: 400 status must be one of: open, in progress, resolved
    else admin and valid
        A->>T: set status
        A-->>C: 200 data
    end
```

## 6. Inspection with late fee, then dispute

The admin records the return. The server computes the fee: the scheduled return instant is the END of the booking's `returnDate` in UTC (23:59:59.999Z), the overdue time is rounded up to whole hours, and the fee is those hours times the provider's `lateFeePerHour` as it is at that moment, which is stored with the inspection. A unique index allows one inspection per booking. The owner (and only the owner) can then dispute once, and only within 7 days of the inspection record, inclusive; both rules are inside one atomic compare-and-set. If both rules are broken the answer is `already been submitted`. An admin closes the dispute with `resolved` or `dismissed`, also by one compare-and-set on `dispute.status` being `open`. Resolving records a decision and does not change the fee.

```mermaid
sequenceDiagram
    participant Ad as Admin client
    participant O as Owner client
    participant A as API
    participant B as Bookings and Providers
    participant I as Inspections collection
    Ad->>A: POST /bookings/:id/inspection with actualReturnTime, odometer, fuelLevel, damageNotes
    A->>B: load booking and provider
    A->>A: scheduled return is end of returnDate in UTC, lateHours is overdue hours rounded up, lateFee is lateHours times lateFeePerHour
    A->>I: create with scheduledReturnAt, lateHours, lateFee, feePerHourUsed
    alt inspection already exists
        A-->>Ad: 409 Inspection already recorded for this booking
    else created
        A-->>Ad: 201 inspection
    end
    O->>A: GET /bookings/:id/inspection
    alt caller is not the owner and not an admin
        A-->>O: 403 Not authorized to access this booking
    else allowed
        A-->>O: 200 report with fee and dispute null
    end
    O->>A: POST /bookings/:id/inspection/dispute with comment
    alt caller is not the owner, an admin included
        A-->>O: 403 Not authorized to dispute this inspection
    else owner
        A->>I: one update, set dispute where dispute is null and inspection not older than 7 days
        alt updated
            A-->>O: 200 inspection with dispute status open
        else not updated and a dispute exists
            A-->>O: 400 A dispute has already been submitted
        else not updated and older than 7 days
            A-->>O: 400 Dispute window of 7 days has passed
        end
    end
    Ad->>A: PUT /bookings/:id/inspection/dispute with status resolved or dismissed and resolutionNote
    A->>I: one update, set dispute status where dispute status is open
    alt updated
        A-->>Ad: 200 inspection, lateFee unchanged
    else there is no dispute
        A-->>Ad: 404 Dispute not found for this inspection
    else dispute already closed
        A-->>Ad: 400 Dispute has already been closed
    end
```

## 7. Statistics report

The report is one database aggregation. `$match` selects the bookings whose pickup date is inside the inclusive UTC range, using the `date, provider` index, and `$facet` computes the total, the per-provider counts and the per-month counts in a single pass. The top 5 is the first five of the per-provider list, which is ordered by count descending, then name, then id. Months without bookings are omitted. Nothing is counted in application code.

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant B as Bookings collection
    C->>A: GET /stats?from=2026-01-01&to=2026-12-31
    alt no valid token
        A-->>C: 401 Not authorized to access this route
    else caller is not an admin
        A-->>C: 403 User role user is not authorized to access this route
    else admin
        A->>A: validate from and to
        alt missing, malformed, to before from or longer than 10 years
            A-->>C: 400 with the specific message
        else valid
            A->>B: aggregate with match on date range, then facet total, perProvider, perMonth
            B-->>A: one report document
            A-->>C: 200 data range, basis booking.date, total, perProvider, perMonth, top5
        end
    end
```
