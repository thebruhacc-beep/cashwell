# Run doc — NeonFinance

Plain Node.js/Express app, no build step. Frontend is vanilla JS in `app.js`
served statically; backend is `server.js` + `routes.js` + `auth.js` +
`database.js`, backed by **Turso** (a free, hosted, SQLite-compatible
database — https://turso.tech).

Railway is no longer used anywhere in this project.

## 1. Local development (no account needed)

```
npm install
npm run dev
```

- Port: `process.env.PORT || 3000` — defaults to **3000**.
- With no `TURSO_DATABASE_URL` set, `database.js` automatically uses a
  local SQLite file (`neonfinance.db`, created in the project root on first
  run) — so local dev needs zero setup.
- Server logs `🟢 NeonFinance running on http://localhost:<port>`.

## 2. Set up the free Turso database (for production)

1. Create a free account at https://turso.tech (no credit card required).
2. Install the CLI and create a database:
   ```
   curl -sSfL https://get.tur.so/install.sh | bash
   turso auth login
   turso db create neonfinance
   ```
3. Get the connection details:
   ```
   turso db show neonfinance --url
   turso db tokens create neonfinance
   ```
4. You'll use these as two environment variables on your host:
   - `TURSO_DATABASE_URL` → the `libsql://...` URL from step 3
   - `TURSO_AUTH_TOKEN` → the token from step 3

Free tier: 5 GB storage, 500M row reads/month, 10M row writes/month,
no card required, no expiry — comfortably enough for this app.

## 3. Deploy for free (Render)

Render's free Web Service tier works well now that the database lives on
Turso instead of local disk (Render's free tier has no persistent disk, so
this used to be a problem — it no longer is).

1. Push this project to a GitHub repo.
2. On https://render.com → **New +** → **Web Service** → connect the repo.
3. Render will detect the `Dockerfile` automatically (build: Docker).
4. Under **Environment**, add:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `JWT_SECRET` (any long random string — see note below)
5. Deploy. You'll get a free `https://<name>.onrender.com` URL.

Notes on the free tier:
- The service spins down after ~15 minutes of no traffic and takes a few
  seconds to wake up on the next request — fine for a personal project or
  demo, not for something latency-sensitive.
- No credit card required for this path.

## 3b. Alternative host

Any Node host that can run a Dockerfile (or plain `npm install && npm start`)
works exactly the same way, since all persistent state now lives in Turso,
not on local disk. Render is just the simplest free option with a real
always-deployed URL.

## 4. Environment variables (all optional locally, required in production)

- `PORT` — defaults to 3000.
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — Turso connection (omit for
  local file-based SQLite).
- `JWT_SECRET` — used to sign login tokens. `auth.js` has a hardcoded
  fallback for local dev; **set a real one in production** or anyone who
  reads the source can forge tokens.
