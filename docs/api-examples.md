# API examples with curl

A hands-on walk through the main flows. Every command was run against a local server; the response bodies below are shortened to the fields that matter. The full description of each endpoint is in `openapi.yaml` (or `/api-docs`) and [uml-profile-for-api.md](uml-profile-for-api.md).

Setup for the shell:

```bash
B=http://localhost:5050/api/v1
JSON='Content-Type: application/json'
```

## 1. Register and log in

```bash
curl -s -X POST $B/auth/register -H "$JSON" \
  -d '{"name":"Somchai Jaidee","telephone":"0812345678","email":"somchai@example.com","password":"secret123"}'
```

```json
{ "success": true, "token": "<jwt>", "data": { "id": "...", "name": "Somchai Jaidee", "email": "somchai@example.com", "role": "user" } }
```

Keep the token in a variable. Login returns the same shape:

```bash
TOKEN=$(curl -s -X POST $B/auth/login -H "$JSON" \
  -d '{"email":"somchai@example.com","password":"secret123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s $B/auth/me -H "Authorization: Bearer $TOKEN"
```

`role` is always `user` after registration, whatever the body says. A token that is missing, malformed, expired or revoked answers the same thing:

```bash
curl -s -i $B/auth/me -H "Authorization: Bearer nope"
# HTTP/1.1 401 Unauthorized
# {"success":false,"message":"Not authorized to access this route"}
```

## 2. Log out (the token is revoked)

```bash
curl -s -X POST $B/auth/logout -H "Authorization: Bearer $TOKEN"   # 200
curl -s $B/auth/me -H "Authorization: Bearer $TOKEN"               # 401, the same token no longer works
```

## 3. Browse providers and book a car

Providers are public:

```bash
curl -s $B/providers
PID=<_id of a provider from the list>
```

```bash
curl -s -X POST $B/providers/$PID/bookings -H "Authorization: Bearer $TOKEN" -H "$JSON" \
  -d '{"date":"2026-12-01","returnDate":"2026-12-04"}'
```

```json
{ "success": true, "data": { "provider": "...", "date": "2026-12-01T00:00:00.000Z", "returnDate": "2026-12-04T00:00:00.000Z", "totalPrice": 3000, "promo": null, "discount": 0 } }
```

The total is the provider's `dailyRate` times the number of days (1000 x 3 here). A fourth booking by the same user answers `400 A user can book at most 3 cars`. Edit or delete with `PUT` and `DELETE` on `$B/bookings/<id>`; another user gets `403`.

## 4. Promo codes

An admin creates a code (log in with the seeded admin account first and keep that token as `ATOK`):

```bash
curl -s -X POST $B/promos -H "Authorization: Bearer $ATOK" -H "$JSON" \
  -d '{"code":"SAVE10","type":"percentage","value":10,"validFrom":"2026-01-01","validTo":"2026-12-31","maxRedemptions":100,"perUserLimit":1}'
```

The booking owner applies it (the code is case-insensitive):

```bash
BID=<_id of the booking>
curl -s -X POST $B/bookings/$BID/promo -H "Authorization: Bearer $TOKEN" -H "$JSON" -d '{"code":"save10"}'
```

```json
{ "success": true, "data": { "totalPrice": 2700, "discount": 300, "promo": "<promo id>" } }
```

Applying a code to a booking that already has one, using it past its limits, or after it expired, answers `400` with a message that names the reason.

## 5. Support tickets

```bash
curl -s -X POST $B/tickets -H "Authorization: Bearer $TOKEN" -H "$JSON" \
  -d "{\"booking\":\"$BID\",\"category\":\"billing\",\"subject\":\"Question about my price\",\"description\":\"Why was the discount 10 percent?\"}"
```

The ticket starts as `open`. Both sides add comments with `POST $B/tickets/<id>/comments` (`{"text":"..."}`); an admin sets the status with `PUT $B/tickets/<id>/status` (`{"status":"resolved"}`). A resolved ticket answers `400 Ticket is resolved` to a new comment until an admin reopens it. A user only ever lists their own tickets; filter with `?status=open&category=billing&page=1&limit=20`.

## 6. Return inspection, late fee and dispute

For a booking whose return date has passed, an admin records the return. The late fee is computed by the server: the scheduled return is the end of `returnDate` in UTC, and each started hour late costs the provider's `lateFeePerHour`.

```bash
# booking dated 2026-11-01 to 2026-11-03 at a provider with lateFeePerHour 200
curl -s -X POST $B/bookings/$BID/inspection -H "Authorization: Bearer $ATOK" -H "$JSON" \
  -d '{"actualReturnTime":"2026-11-04T02:59:59.999Z","odometer":45210,"fuelLevel":40,"damageNotes":"Scratch on the rear bumper"}'
```

Returned three hours after the end of 3 November, that gives `lateHours` 3 and `lateFee` 600. `actualReturnTime` must carry a zone (`Z` or `+07:00`) and may not be more than 24 hours in the future. A second inspection for the same booking answers `409`.

The booking owner can dispute once within seven days:

```bash
curl -s -X POST $B/bookings/$BID/inspection/dispute -H "Authorization: Bearer $TOKEN" -H "$JSON" \
  -d '{"comment":"The scratch was already there at pickup."}'
```

An admin closes it with `PUT` on the same path and `{"status":"resolved","resolutionNote":"..."}` (or `dismissed`). Resolving records a decision and does not change the fee.

## 7. Admin audit log and statistics

Every admin view, edit and delete of a booking is logged; read the log with filters:

```bash
curl -s "$B/audit?booking=$BID&page=1&limit=20" -H "Authorization: Bearer $ATOK"
```

There is no way to change or delete an entry: `PUT`, `PATCH` and `DELETE` on `$B/audit/<id>` answer `404`.

Bookings per provider and per month over a date range (both dates required, at most ten years apart):

```bash
curl -s "$B/stats?from=2026-01-01&to=2026-12-31" -H "Authorization: Bearer $ATOK"
```

```json
{ "success": true, "data": { "range": { "from": "2026-01-01T00:00:00.000Z", "to": "2026-12-31T23:59:59.999Z" }, "basis": "booking.date",
  "total": 1, "perProvider": [{ "provider": "...", "name": "Alpha Rentals", "count": 1 }], "perMonth": [{ "month": "2026-12", "count": 1 }], "top5": [...] } }
```

## 8. Login protection

Five wrong passwords in a row lock the account for 15 minutes. While it is locked even the right password answers `401 Invalid credentials`, exactly like a wrong one or an unknown email. Separately, an IP may send 10 login requests per minute; the 11th answers `429` with a `Retry-After` header and a `retryAfter` number of seconds.

## Common errors

| Status | When |
| --- | --- |
| 400 | validation failed; the message says which rule |
| 401 | no token, or a bad, expired or revoked one; wrong credentials at login |
| 403 | the role is wrong (`User role user is not authorized...`) or the booking or ticket belongs to someone else |
| 404 | the resource does not exist, or the id in the path is malformed |
| 409 | a concurrent change won (`...modified concurrently, please retry`), a duplicate promo code, an inspection that already exists, or a provider that still has bookings |
| 429 | the login limiter |
