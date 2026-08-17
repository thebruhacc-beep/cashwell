// server.js — local development server.
//
// This is only used for `npm run dev` on your own machine. The actual
// production deployment on Vercel uses api/index.js instead (Vercel runs
// each request as its own short-lived function, so there's no long-running
// `server.listen()` process there — see api/index.js and vercel.json).
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const db      = require('./database');
const routes  = require('./routes');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use('/api', routes);

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await db.initDb();
  app.listen(PORT, () => {
    console.log(`\n🟢 NeonFinance running on http://localhost:${PORT}`);
    console.log(`   Open your browser and go to http://localhost:${PORT}\n`);
  });
}

start().catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});
