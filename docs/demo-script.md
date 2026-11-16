# Demo script (7 minutes, Postman Collection Runner)

Presenter notes for `__tests__/demo.postman_collection.json`. The collection numbers every request, so this script follows the same numbers.

## Before you present

1. Start the API in development mode so the login limiter is on: `npm start` (port 5050).
2. In Postman, import `__tests__/demo.postman_collection.json` and `__tests__/demo.postman_environment.json`.
3. Select the `rental-car-api-demo` environment and set `baseUrl` (`http://localhost:5050`), `adminEmail` and `adminPassword`.
4. Rehearse once, then wait 60 seconds before the real run. The demo spends the whole minute's 10 login budget on purpose.
5. Use the development database, never the `_test` one.

## Talking track

| Section | Requests | Say | Point at in the response |
| --- | --- | --- | --- |
| 1 Public | 1.1 to 1.2 | Providers are public, no token needed. | 200 and the two seeded providers |
| 2 Register, login, logout | 2.1 to 2.7 | Register, duplicate email refused, login, logout revokes the token on the server. | 2.2 is a 4xx, 2.6 replays the old token and is refused |
| 3 Bookings | 3.1 to 3.9 | A user can hold 3 bookings, the 4th is refused. Other users cannot read your booking, admins can. | 3.6 refused, 3.7 refused, 3.8 is 200 |
| 4 Promo code | 4.1 to 4.4 | Admin creates a 10 percent code limited to one redemption. The second user cannot reuse it. | 4.3 price drops, 4.4 refused |
| 5 Audit log | 5.1 to 5.6 | Every admin view and edit is logged with before and after values. Entries cannot be changed or deleted. | 5.3 shows the entries, 5.4 to 5.6 are refused |
| 6 Support tickets | 6.1 to 6.5 | User and admin exchange comments, admin sets the status, a resolved ticket takes no more comments. | 6.5 refused |
| 7 Inspection and late fee | 7.1 to 7.6 | Only an admin records the return. The late fee is computed (hours late, rounded up, times the provider's hourly fee). The owner can dispute once, an admin resolves it. | 7.1 refused, 7.2 fee in the body, 7.5 refused |
| 8 Statistics | 8.1 to 8.2 | Admin only report of bookings per provider and per month. | 8.2 refused |
| 9 Login protection | 9.1 to 9.8 | Five wrong passwords lock the account for 15 minutes, even the right password is then refused. Flooding the login endpoint hits the rate limit. | 9.7 still refused, 9.8 ends with 429 |

Section 9 must stay last, because it uses up the login budget.

## Running it

- **Collection Runner:** open the collection, click Run, keep the listed order, press Run. Everything should be green; the whole run takes about 10 seconds.
- **Newman (backup if Postman misbehaves):** in a second terminal
  `export adminEmail='...' adminPassword='...'` then `npm run demo`.

## If something goes wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| The run stops at the first login with "RATE LIMIT ALREADY SPENT" | The previous run was less than a minute ago | Wait the number of seconds it prints, or restart the server |
| The 429 assertion shows as skipped | Server was started with `NODE_ENV=test` | Restart with plain `npm start` |
| Admin login fails | `adminEmail` or `adminPassword` do not match `config/config.env` | Copy `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` |
| Connection refused | Server not running or wrong port | `npm start` and check `baseUrl` |

## Questions to expect

- **Why can't the promo be over-redeemed under concurrency?** The redemption is claimed with an atomic database update. `npm run demo:race -- promo` fires 20 requests at once and prints the counts.
- **Why does a locked account answer the same error as a wrong password?** So emails cannot be discovered through the lockout.
- **Does resolving a dispute change the fee?** No, it records a decision only (listed under "Not implemented" in the README).
