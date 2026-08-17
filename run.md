# Run doc — NeonFinance

Plain Node.js/Express app. Frontend is vanilla JS in `app.js` served as a
static file; backend is `routes.js` + `auth.js` + `database.js`, backed by
**Turso** (free, hosted, SQLite-compatible — https://turso.tech).

Deploys to **Vercel's Hobby plan** — genuinely free, no credit card, forever,
for personal/non-commercial projects. The trade-off: Vercel runs your API as
short-lived serverless functions, not one long-running process, so real-time
updates use polling (~every 4s) instead of Socket.io/websockets.

Railway and Socket.io are no longer used anywhere in this project.

## 1. Local development

```
npm install
npm run dev
```

- Runs `server.js`, a normal always-on Express server — this is just for
  your own machine, not what actually gets deployed.
- Port: `process.env.PORT || 3000` — defaults to **3000**.
- With no `TURSO_DATABASE_URL` set, `database.js` automatically uses a local
  SQLite file (`neonfinance.db`), so local dev needs zero setup.

## 2. Set up the free Turso database

1. Free account at https://turso.tech (no credit card).
2. CLI:
   ```
   curl -sSfL https://get.tur.so/install.sh | bash
   turso auth login
   turso db create neonfinance
   turso db show neonfinance --url
   turso db tokens create neonfinance
   ```
3. You now have two values:
   - `TURSO_DATABASE_URL` → the `libsql://...` URL
   - `TURSO_AUTH_TOKEN` → the token

Free tier: 5 GB storage, 500M row reads/month, 10M row writes/month, no
card, no expiry.

## 3. Deploy to Vercel (free, no card)

1. Push this project to a GitHub repo.
2. Sign up at https://vercel.com (GitHub login works, no card asked).
3. **Add New → Project** → import the repo. Vercel auto-detects it (no
   framework preset needed — it just serves static files at the root and
   picks up `api/index.js` as a serverless function via `vercel.json`).
4. Under **Environment Variables**, add:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `JWT_SECRET` — any long random string (Vercel doesn't have a
     one-click generate button like some other hosts; make one yourself,
     e.g. run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
     locally and paste the result)
5. Deploy. You get a free `https://<project>.vercel.app` URL.

### Vercel Hobby's one real restriction

Hobby is free forever but **for personal/non-commercial use only** — no
ads, no payments, no paid client work running on it. Fine for this project
as it stands; if you ever turn it into something you charge for, that's
the point where you'd move to Vercel Pro ($20/mo) or one of the
card-verified hosts (Render, Northflank) instead.

## 4. What changed vs. the Socket.io version

- Real-time chat/deposit/group updates now poll the API every 4 seconds
  (`app.js` → `startPolling()`) instead of pushing over a websocket.
  Noticeably the same in daily use, just not instant-instant.
- `server.js` (local dev) and `api/index.js` (Vercel) share the same
  `routes.js` / `database.js` — no logic is duplicated, just the
  entry point differs.

## 5. Environment variables

- `PORT` — local dev only, defaults to 3000.
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — Turso connection (omit
  locally for file-based SQLite).
- `JWT_SECRET` — signs login tokens. **Set a real one on Vercel** — the
  fallback in `auth.js` is only safe for local dev.
