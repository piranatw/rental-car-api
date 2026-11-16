# Contributing

Both team members work on the same repository. This page is the short version of how.

## Setup

See the README: install, create `config/config.env`, start a dedicated MongoDB, `npm start`.

## Before you push

```bash
npm run test:unit                       # seconds, no database
source config/test-env.sh && npm test   # about 5 minutes, needs the _test database
```

Run the unit tests every time. Run the full suite before anything that touches a controller, a model or the routes. CI repeats both on every push and pull request.

## Branches and commits

- Branch from `main` for anything bigger than a one-file fix; open a pull request and let the other person read it.
- One idea per commit. The message starts with a type: `feat:`, `fix:`, `test:`, `docs:` or `chore:`, then what changed and why in a short line.
- Commit under your own name and email (`git config user.name`, `git config user.email`). The course grades each person's real contribution, and `git shortlog` and `git blame` must match [docs/work-division.md](docs/work-division.md).

## Adding or changing an endpoint

1. Route in `routes/<area>.js`, with `protect` and `authorize(...)` where needed.
2. Handler in `controllers/<area>.js`, following the existing envelope: `{ success, data }` or `{ success, message }`. Validate input, check ownership, never read a field the client must not set.
3. Schema rules in `models/`, so invalid data is refused even if a controller forgets.
4. Document it in `openapi.yaml` and in [docs/uml-profile-for-api.md](docs/uml-profile-for-api.md). `npm run test:unit` fails if a route exists in the code but not in the OpenAPI file, or the other way round.
5. Tests: Postman requests for the success case, a validation error, no token and the wrong role; a script in `scripts/` if the rule must hold under concurrency. See [docs/testing.md](docs/testing.md).

## Rules the code relies on

- A rule that can race is one atomic database operation with the condition inside the filter, not a read followed by a write.
- Error messages that a client sees are written once and tested; a failure must not reveal whether an account or id exists.
- Dates are UTC and ISO 8601. Out-of-range input is rejected, not clamped.
- No secrets in the repository. `config/config.env` and `config/test-env.sh` stay git-ignored.

## Questions

Read [docs/architecture.md](docs/architecture.md) first; it says where each rule lives.
