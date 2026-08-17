// api/index.js — Vercel serverless entry point.
//
// Vercel routes every /api/* request to this single function (see the
// rewrite in vercel.json). It wraps the same Express app + routes used by
// server.js for local dev, minus app.listen() — Vercel handles that part.
const express = require('express');
const cors    = require('cors');
const db      = require('../database');
const routes  = require('../routes');

const app = express();
app.use(cors());
app.use(express.json());

// Turso schema init only needs to run once per cold start; cache the
// promise so warm invocations skip straight to the route handler.
let initPromise = null;
app.use((req, res, next) => {
  if (!initPromise) initPromise = db.initDb();
  initPromise.then(() => next()).catch(next);
});

app.use('/api', routes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
