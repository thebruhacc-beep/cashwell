// server.js — NeonFinance main server
const express = require('express');
const http    = require('http');
const cors    = require('cors');
const path    = require('path');
const { Server } = require('socket.io');
const { verifyToken } = require('./auth');
const db      = require('./database');
const routes  = require('./routes');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── SERVE STATIC FILES (index.html, style.css, app.js) ──────────────────────
app.use(express.static(path.join(__dirname)));

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.use('/api', routes);

// ─── SPA FALLBACK ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  // Only for non-API routes
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── SOCKET.IO — real-time group events ───────────────────────────────────────
async function userGroupId(userId) {
  const r = await db.prepare('SELECT group_id FROM group_members WHERE user_id=?').get(userId);
  return r?.group_id || null;
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('No token'));
  try {
    socket.user = verifyToken(token);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', async (socket) => {
  const userId = socket.user.id;

  // Join this user into their group's Socket room
  try {
    const gid = await userGroupId(userId);
    if (gid) socket.join(`group:${gid}`);
  } catch (e) { console.error('socket join error:', e); }

  // Re-join if they switch groups
  socket.on('group:join', (groupId) => {
    socket.rooms.forEach(r => { if (r.startsWith('group:')) socket.leave(r); });
    if (groupId) socket.join(`group:${groupId}`);
  });

  // Broadcast new chat message to group
  socket.on('message:send', async (msg) => {
    try {
      const g = await userGroupId(userId);
      if (g) socket.to(`group:${g}`).emit('message:new', msg);
    } catch (e) { console.error('message:send error:', e); }
  });

  // Broadcast deposit changes to group
  socket.on('deposit:change', async (dep) => {
    try {
      const g = await userGroupId(userId);
      if (g) io.to(`group:${g}`).emit('deposit:update', dep);
    } catch (e) { console.error('deposit:change error:', e); }
  });

  // Broadcast group structure changes (join/leave/payment settings)
  socket.on('group:change', async () => {
    try {
      const g = await userGroupId(userId);
      if (g) socket.to(`group:${g}`).emit('group:refresh');
    } catch (e) { console.error('group:change error:', e); }
  });

  socket.on('disconnect', () => {});
});

// ─── START ────────────────────────────────────────────────────────────────────
async function start() {
  await db.initDb();
  server.listen(PORT, () => {
    console.log(`\n🟢 NeonFinance running on http://localhost:${PORT}`);
    console.log(`   Open your browser and go to http://localhost:${PORT}\n`);
  });
}

start().catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});
