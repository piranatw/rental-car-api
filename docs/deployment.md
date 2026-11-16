# Deployment and configuration

## Configuration

All settings come from environment variables. For local work put them in `config/config.env` (git-ignored; copy `config/config.env.example`). Variables already exported in the shell win over the file.

| Variable | Required | Meaning |
| --- | --- | --- |
| `MONGO_URI` | yes | MongoDB connection string, including the database name |
| `JWT_SECRET` | yes | signing key for tokens; use at least 32 random bytes (`openssl rand -hex 32`) |
| `JWT_EXPIRE` | yes | token lifetime, for example `30d` |
| `JWT_COOKIE_EXPIRE` | no | cookie lifetime in days (default 30) |
| `PORT` | yes | port to listen on |
| `NODE_ENV` | no | `production` makes the cookie `secure`; `test` turns the login limiter off |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | first start | creates the admin account if it does not exist |
| `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES` | no | lockout tuning (defaults 5 and 15) |

Never commit a real value. The server refuses to start without `MONGO_URI`.

On first start the server also creates two providers if the collection is empty (Alpha Rentals and Beta Cars), so the demo and the test suite have something to book.

## Run locally

```bash
npm install
cp config/config.env.example config/config.env   # then fill in the values
npm start
```

Then open `http://localhost:5050/api-docs` for the interactive documentation.

## Run with Docker

The `Dockerfile` builds a small Node 24 image that installs production dependencies only and runs as the unprivileged `node` user. `docker-compose.yml` adds a MongoDB container with a named volume:

```bash
export JWT_SECRET=$(openssl rand -hex 32) SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=choose-a-password
docker compose up --build
```

Compose refuses to start if one of those three variables is missing, so the container never runs with an empty secret. The image does not contain `config/config.env`, the tests or the documents (see `.dockerignore`).

## MongoDB options

- **Atlas:** create a project and a free M0 cluster, add a database user, add your IP under Network Access, and copy the connection string from Connect > Drivers. A paused free cluster must be resumed before use.
- **Local `mongod`:** a dedicated instance on its own port and data directory. Do not point this project at a database that another project uses, and never at one whose data you care about when running the tests: they drop the `_test` database.

## Behind a proxy or load balancer

The login limiter counts the socket address and `trust proxy` is deliberately off, so that a caller cannot use `X-Forwarded-For` to dodge the limit. The consequence: behind a reverse proxy or load balancer every request appears to come from the proxy, and all users would share one 10-per-minute budget. If the API is deployed behind one, enable `app.set('trust proxy', <number of proxies>)` for exactly the proxies you control, and add a unit test for the new setting. The project has not been deployed behind a proxy, so this is untested.

## Production checklist

- A long random `JWT_SECRET`, different from every other environment.
- `NODE_ENV=production`, and HTTPS in front of the API (the cookie is `secure` and helmet sends HSTS).
- A MongoDB user that can only reach this project's database.
- Back up the database. Audit entries and inspections are append-only records.
- Keep the seeded admin password out of source control and change it after first login if the account is shared.
