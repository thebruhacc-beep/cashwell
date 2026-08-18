// routes.js — all API route handlers
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { signToken, hashPassword, checkPassword, requireAuth } = require('./auth');

const router = express.Router();

const DEFAULT_WALLETS    = ['Cash', 'Bank', 'Crypto'];
const DEFAULT_CATEGORIES = ['Crypto','Freelance','Salary','Trading','Investment','Side Hustle','Other'];

const now      = () => new Date().toISOString();
const todayStr = () => new Date().toISOString().split('T')[0];

// Wraps an async route handler so rejected promises reach Express's error
// handler instead of hanging the request (Express 4 doesn't do this for you).
const ah = fn => (req, res, next) => fn(req, res, next).catch(next);

// ─── helpers ──────────────────────────────────────────────────────────────────
async function userGroupId(userId) {
  const r = await db.prepare('SELECT group_id FROM group_members WHERE user_id=?').get(userId);
  return r?.group_id || null;
}

async function getFullGroup(groupId) {
  const g = await db.prepare('SELECT * FROM groups_table WHERE id=?').get(groupId);
  if (!g) return null;
  const members = await db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar, gm.joined_at
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
  `).all(groupId);
  return { ...g, members };
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════════

// POST /api/auth/register
router.post('/auth/register', ah(async (req, res) => {
  const { username, password, displayName } = req.body || {};
  if (!username || !password || !displayName)
    return res.status(400).json({ error: 'username, password and displayName are required' });
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const exists = await db.prepare('SELECT id FROM users WHERE LOWER(username)=LOWER(?)').get(username);
  if (exists) return res.status(409).json({ error: 'Username already taken' });

  const id     = uuidv4();
  const avatar = displayName.trim()[0].toUpperCase();

  await db.prepare('INSERT INTO users (id,username,password,display_name,avatar,created_at) VALUES (?,?,?,?,?,?)')
    .run(id, username.toLowerCase(), hashPassword(password), displayName.trim(), avatar, now());

  // seed defaults
  await Promise.all(DEFAULT_WALLETS.map(w =>
    db.prepare('INSERT OR IGNORE INTO wallet_types (user_id,name,balance) VALUES (?,?,0)').run(id, w)));
  await Promise.all(DEFAULT_CATEGORIES.map(c =>
    db.prepare('INSERT OR IGNORE INTO categories (user_id,name) VALUES (?,?)').run(id, c)));

  const token = signToken({ id, username: username.toLowerCase() });
  res.json({ token, user: { id, username: username.toLowerCase(), displayName: displayName.trim(), avatar } });
}));

// POST /api/auth/login
router.post('/auth/login', ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const user = await db.prepare('SELECT * FROM users WHERE LOWER(username)=LOWER(?)').get(username);
  if (!user || !checkPassword(password, user.password))
    return res.status(401).json({ error: 'Invalid username or password' });

  const token = signToken({ id: user.id, username: user.username });
  res.json({ token, user: { id: user.id, username: user.username, displayName: user.display_name, avatar: user.avatar } });
}));

// GET /api/auth/me
router.get('/auth/me', requireAuth, ah(async (req, res) => {
  const user = await db.prepare('SELECT id,username,display_name,avatar FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, username: user.username, displayName: user.display_name, avatar: user.avatar });
}));

// ════════════════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ════════════════════════════════════════════════════════════════════════════

router.get('/transactions', requireAuth, ah(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC, created_at DESC').all(req.user.id);
  res.json(rows);
}));

router.post('/transactions', requireAuth, ah(async (req, res) => {
  const { amount, category, wallet, date, note } = req.body || {};
  if (amount === undefined || !category || !wallet || !date)
    return res.status(400).json({ error: 'amount, category, wallet and date required' });
  const id = uuidv4();
  await db.prepare('INSERT INTO transactions (id,user_id,amount,category,wallet,date,note,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, req.user.id, Number(amount), category, wallet, date, note || '', now());
  res.json(await db.prepare('SELECT * FROM transactions WHERE id=?').get(id));
}));

router.delete('/transactions/:id', requireAuth, ah(async (req, res) => {
  const tx = await db.prepare('SELECT * FROM transactions WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  await db.prepare('DELETE FROM transactions WHERE id=?').run(req.params.id);
  res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════════════════════
// WALLET
// ════════════════════════════════════════════════════════════════════════════

router.get('/wallet', requireAuth, ah(async (req, res) => {
  res.json(await db.prepare('SELECT name,balance,asset FROM wallet_types WHERE user_id=?').all(req.user.id));
}));

router.put('/wallet/:name', requireAuth, ah(async (req, res) => {
  const { balance, asset } = req.body || {};
  await db.prepare('INSERT INTO wallet_types (user_id,name,balance,asset) VALUES (?,?,?,?) ON CONFLICT(user_id,name) DO UPDATE SET balance=excluded.balance, asset=excluded.asset')
    .run(req.user.id, req.params.name, Number(balance) || 0, asset || null);
  res.json({ ok: true });
}));

router.post('/wallet', requireAuth, ah(async (req, res) => {
  const { name, asset } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  await db.prepare('INSERT OR IGNORE INTO wallet_types (user_id,name,balance,asset) VALUES (?,?,0,?)').run(req.user.id, name, asset || null);
  res.json({ ok: true });
}));

router.delete('/wallet/:name', requireAuth, ah(async (req, res) => {
  await db.prepare('DELETE FROM wallet_types WHERE user_id=? AND name=?').run(req.user.id, decodeURIComponent(req.params.name));
  res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════════════════════
// CATEGORIES
// ════════════════════════════════════════════════════════════════════════════

router.get('/categories', requireAuth, ah(async (req, res) => {
  const rows = await db.prepare('SELECT name FROM categories WHERE user_id=?').all(req.user.id);
  res.json(rows.map(r => r.name));
}));

router.post('/categories', requireAuth, ah(async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  await db.prepare('INSERT OR IGNORE INTO categories (user_id,name) VALUES (?,?)').run(req.user.id, name);
  res.json({ ok: true });
}));

router.delete('/categories/:name', requireAuth, ah(async (req, res) => {
  await db.prepare('DELETE FROM categories WHERE user_id=? AND name=?').run(req.user.id, decodeURIComponent(req.params.name));
  res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════════════════════
// GROUPS
// ════════════════════════════════════════════════════════════════════════════

router.get('/groups/mine', requireAuth, ah(async (req, res) => {
  const gid = await userGroupId(req.user.id);
  res.json(gid ? await getFullGroup(gid) : null);
}));

router.post('/groups', requireAuth, ah(async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  if (await userGroupId(req.user.id)) return res.status(409).json({ error: 'Already in a group' });

  const id   = uuidv4();
  const code = Math.random().toString(36).slice(2,8).toUpperCase();

  await db.prepare('INSERT INTO groups_table (id,name,code,admin_id,created_at) VALUES (?,?,?,?,?)')
    .run(id, name, code, req.user.id, now());
  await db.prepare('INSERT INTO group_members (group_id,user_id,joined_at) VALUES (?,?,?)')
    .run(id, req.user.id, now());

  res.json(await getFullGroup(id));
}));

router.post('/groups/join', requireAuth, ah(async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code required' });
  if (await userGroupId(req.user.id)) return res.status(409).json({ error: 'Already in a group. Leave first.' });

  const g = await db.prepare('SELECT * FROM groups_table WHERE UPPER(code)=UPPER(?)').get(code.trim());
  if (!g) return res.status(404).json({ error: 'Invalid invite code' });

  await db.prepare('INSERT OR IGNORE INTO group_members (group_id,user_id,joined_at) VALUES (?,?,?)').run(g.id, req.user.id, now());
  res.json(await getFullGroup(g.id));
}));

router.delete('/groups/leave', requireAuth, ah(async (req, res) => {
  const { targetUserId } = req.body || {};
  const kickId = targetUserId || req.user.id;
  const gid    = await userGroupId(req.user.id);
  if (!gid) return res.status(404).json({ error: 'Not in a group' });

  const g = await db.prepare('SELECT * FROM groups_table WHERE id=?').get(gid);
  if (kickId !== req.user.id && g.admin_id !== req.user.id)
    return res.status(403).json({ error: 'Only admin can kick members' });

  // Reset all deposits of the leaving/kicked member to 0
  await db.prepare("UPDATE deposits SET amount=0, status='cancelled', cancelled_at=? WHERE group_id=? AND user_id=? AND status='confirmed'")
    .run(new Date().toISOString(), gid, kickId);

  await db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(gid, kickId);

  const remaining = await db.prepare('SELECT COUNT(*) as c FROM group_members WHERE group_id=?').get(gid);
  if (!remaining || remaining.c === 0) {
    await db.prepare('DELETE FROM groups_table WHERE id=?').run(gid);
    return res.json({ deleted: true });
  }
  res.json({ ok: true });
}));

router.put('/groups/payment', requireAuth, ah(async (req, res) => {
  const { paypal, pay_note } = req.body || {};
  const gid = await userGroupId(req.user.id);
  if (!gid) return res.status(404).json({ error: 'Not in a group' });
  const g = await db.prepare('SELECT * FROM groups_table WHERE id=?').get(gid);
  if (g.admin_id !== req.user.id) return res.status(403).json({ error: 'Admin only' });
  await db.prepare('UPDATE groups_table SET paypal=?, pay_note=? WHERE id=?').run(paypal||'', pay_note||'', gid);
  res.json({ ok: true });
}));

// Chat retention (daily/weekly auto-delete window) — any group member can change it,
// same as anyone in a Snapchat group chat can flip the timer for everyone.
router.put('/groups/chat-retention', requireAuth, ah(async (req, res) => {
  const { retention } = req.body || {};
  if (!['daily', 'weekly'].includes(retention)) return res.status(400).json({ error: 'Invalid retention value' });
  const gid = await userGroupId(req.user.id);
  if (!gid) return res.status(404).json({ error: 'Not in a group' });
  await db.prepare('UPDATE groups_table SET retention=? WHERE id=?').run(retention, gid);
  res.json({ ok: true, retention });
}));

router.get('/groups/member/:id/stats', requireAuth, ah(async (req, res) => {
  const gid = await userGroupId(req.user.id);
  if (!gid) return res.status(404).json({ error: 'Not in a group' });

  // Only allow looking up stats for someone in your own group
  const membership = await db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, req.params.id);
  if (!membership) return res.status(404).json({ error: 'Member not found in your group' });

  const txs     = await db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC').all(req.params.id);
  const wallets = await db.prepare('SELECT name,balance,asset FROM wallet_types WHERE user_id=?').all(req.params.id);

  const today    = todayStr();
  const weekAgo  = new Date(Date.now() - 7*24*60*60*1000).toISOString().split('T')[0];
  const monthStr = today.slice(0, 7); // YYYY-MM
  const yearStr  = today.slice(0, 4); // YYYY

  function computeStats(list) {
    const profit  = list.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const loss    = list.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    const amounts = list.map(t => t.amount);
    return {
      total:   profit + loss,
      profit,
      loss,
      entries: list.length,
      best:    amounts.length ? Math.max(...amounts) : null,
      worst:   amounts.length ? Math.min(...amounts) : null,
    };
  }

  function categoryBreakdown(list) {
    const map = {};
    list.forEach(t => { map[t.category] = (map[t.category] || 0) + t.amount; });
    return Object.entries(map)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 8);
  }

  const periods = {
    day:   txs.filter(t => t.date === today),
    week:  txs.filter(t => t.date >= weekAgo),
    month: txs.filter(t => t.date.startsWith(monthStr)),
    year:  txs.filter(t => t.date.startsWith(yearStr)),
    total: txs,
  };

  const stats = {}, categories = {};
  for (const [key, list] of Object.entries(periods)) {
    stats[key] = computeStats(list);
    categories[key] = categoryBreakdown(list);
  }

  res.json({ stats, categories, wallets });
}));

// ════════════════════════════════════════════════════════════════════════════
// DEPOSITS
// ════════════════════════════════════════════════════════════════════════════

router.get('/deposits', requireAuth, ah(async (req, res) => {
  const gid = await userGroupId(req.user.id);
  if (!gid) return res.json([]);
  res.json(await db.prepare('SELECT * FROM deposits WHERE group_id=? ORDER BY created_at DESC').all(gid));
}));

router.post('/deposits', requireAuth, ah(async (req, res) => {
  const { amount, source, method, note } = req.body || {};
  const gid = await userGroupId(req.user.id);
  if (!gid) return res.status(404).json({ error: 'Not in a group' });

  const user = await db.prepare('SELECT username,display_name FROM users WHERE id=?').get(req.user.id);
  const id   = uuidv4();

  await db.prepare('INSERT INTO deposits (id,group_id,user_id,username,amount,source,method,note,date,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, gid, req.user.id, user.display_name, Number(amount), source, method||'PayPal', note||'', todayStr(), 'pending', now());

  res.json(await db.prepare('SELECT * FROM deposits WHERE id=?').get(id));
}));

router.put('/deposits/:id/confirm', requireAuth, ah(async (req, res) => {
  const gid = await userGroupId(req.user.id);
  if (!gid) return res.status(404).json({ error: 'Not in a group' });
  const g = await db.prepare('SELECT * FROM groups_table WHERE id=?').get(gid);
  if (g.admin_id !== req.user.id) return res.status(403).json({ error: 'Admin only' });

  const dep = await db.prepare('SELECT * FROM deposits WHERE id=? AND group_id=?').get(req.params.id, gid);
  if (!dep) return res.status(404).json({ error: 'Deposit not found' });
  if (dep.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

  await db.prepare("UPDATE deposits SET status='confirmed', confirmed_at=? WHERE id=?").run(now(), dep.id);

  // Deduct from depositor's wallet
  const wt = await db.prepare('SELECT balance FROM wallet_types WHERE user_id=? AND name=?').get(dep.user_id, dep.source);
  if (wt) {
    await db.prepare('UPDATE wallet_types SET balance=? WHERE user_id=? AND name=?')
      .run(Math.max((wt.balance||0) - dep.amount, 0), dep.user_id, dep.source);
  }

  res.json(await db.prepare('SELECT * FROM deposits WHERE id=?').get(dep.id));
}));

router.put('/deposits/:id/cancel', requireAuth, ah(async (req, res) => {
  const gid = await userGroupId(req.user.id);
  if (!gid) return res.status(404).json({ error: 'Not in a group' });
  const g = await db.prepare('SELECT * FROM groups_table WHERE id=?').get(gid);
  if (g.admin_id !== req.user.id) return res.status(403).json({ error: 'Admin only' });

  const dep = await db.prepare('SELECT * FROM deposits WHERE id=? AND group_id=?').get(req.params.id, gid);
  if (!dep) return res.status(404).json({ error: 'Deposit not found' });

  await db.prepare("UPDATE deposits SET status='cancelled', cancelled_at=? WHERE id=?").run(now(), dep.id);
  res.json(await db.prepare('SELECT * FROM deposits WHERE id=?').get(dep.id));
}));

// ════════════════════════════════════════════════════════════════════════════
// MESSAGES
// ════════════════════════════════════════════════════════════════════════════

// Deletes unsaved messages older than the group's retention window (1 day for
// 'daily', 7 for 'weekly'). Called lazily on every GET /messages instead of a
// cron job, since Vercel's serverless functions have no long-running process
// to schedule one on — this keeps the "disappearing chat" behavior without
// needing any extra infra.
async function cleanupOldMessages(gid, retention) {
  const days   = retention === 'weekly' ? 7 : 1;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const stale  = await db.prepare('SELECT id FROM messages WHERE group_id=? AND saved=0 AND created_at<?').all(gid, cutoff);
  if (!stale.length) return;
  for (const m of stale) {
    await db.prepare('DELETE FROM poll_votes WHERE message_id=?').run(m.id);
  }
  await db.prepare('DELETE FROM messages WHERE group_id=? AND saved=0 AND created_at<?').run(gid, cutoff);
}

router.get('/messages', requireAuth, ah(async (req, res) => {
  const gid = await userGroupId(req.user.id);
  if (!gid) return res.json([]);

  const g = await db.prepare('SELECT retention FROM groups_table WHERE id=?').get(gid);
  await cleanupOldMessages(gid, g?.retention || 'daily');

  const msgs = await db.prepare('SELECT * FROM messages WHERE group_id=? ORDER BY created_at ASC LIMIT 200').all(gid);

  const result = await Promise.all(msgs.map(async m => {
    if (m.type === 'poll') {
      try {
        const data  = JSON.parse(m.content);
        const votes = await db.prepare('SELECT option_idx, user_id FROM poll_votes WHERE message_id=?').all(m.id);
        data.options = (data.options||[]).map((opt, i) => ({
          ...opt,
          votes: votes.filter(v => v.option_idx === i).map(v => v.user_id)
        }));
        return { ...m, content: JSON.stringify(data) };
      } catch { return m; }
    }
    return m;
  }));

  res.json(result);
}));

router.post('/messages', requireAuth, ah(async (req, res) => {
  const { type, content } = req.body || {};
  const gid = await userGroupId(req.user.id);
  if (!gid) return res.status(403).json({ error: 'Not in a group' });

  const user = await db.prepare('SELECT display_name FROM users WHERE id=?').get(req.user.id);
  const id   = uuidv4();

  await db.prepare('INSERT INTO messages (id,group_id,user_id,username,type,content,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, gid, req.user.id, user.display_name, type||'text', content, now());

  res.json(await db.prepare('SELECT * FROM messages WHERE id=?').get(id));
}));

router.post('/messages/:id/vote', requireAuth, ah(async (req, res) => {
  const { optionIdx } = req.body || {};
  const msg = await db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.id);
  if (!msg || msg.type !== 'poll') return res.status(404).json({ error: 'Poll not found' });

  const existing = await db.prepare('SELECT * FROM poll_votes WHERE message_id=? AND user_id=?').get(req.params.id, req.user.id);
  if (existing) {
    if (existing.option_idx === optionIdx) {
      await db.prepare('DELETE FROM poll_votes WHERE message_id=? AND user_id=?').run(req.params.id, req.user.id);
    } else {
      await db.prepare('UPDATE poll_votes SET option_idx=? WHERE message_id=? AND user_id=?').run(optionIdx, req.params.id, req.user.id);
    }
  } else {
    await db.prepare('INSERT INTO poll_votes (message_id,user_id,option_idx) VALUES (?,?,?)').run(req.params.id, req.user.id, optionIdx);
  }
  res.json({ ok: true });
}));

// Toggle "keep forever" on a message — like Snapchat's save, this is visible
// to (and togglable by) everyone in the group, not just the sender.
router.post('/messages/:id/save', requireAuth, ah(async (req, res) => {
  const gid = await userGroupId(req.user.id);
  if (!gid) return res.status(403).json({ error: 'Not in a group' });
  const msg = await db.prepare('SELECT * FROM messages WHERE id=? AND group_id=?').get(req.params.id, gid);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  const saved = msg.saved ? 0 : 1;
  await db.prepare('UPDATE messages SET saved=? WHERE id=?').run(saved, msg.id);
  res.json({ ok: true, saved: !!saved });
}));

// ════════════════════════════════════════════════════════════════════════════
// TODOS — simple personal todo list (sidebar widget on the Calendar page)
// ════════════════════════════════════════════════════════════════════════════

router.get('/todos', requireAuth, ah(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM todos WHERE user_id=? ORDER BY position ASC, created_at ASC').all(req.user.id);
  res.json(rows);
}));

router.post('/todos', requireAuth, ah(async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });
  const id = uuidv4();
  const last = await db.prepare('SELECT MAX(position) AS m FROM todos WHERE user_id=?').get(req.user.id);
  const position = (last?.m ?? -1) + 1;
  await db.prepare('INSERT INTO todos (id,user_id,text,done,position,created_at) VALUES (?,?,?,0,?,?)')
    .run(id, req.user.id, text.trim(), position, now());
  res.json(await db.prepare('SELECT * FROM todos WHERE id=?').get(id));
}));

router.put('/todos/:id', requireAuth, ah(async (req, res) => {
  const todo = await db.prepare('SELECT * FROM todos WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!todo) return res.status(404).json({ error: 'Todo not found' });
  const { text, done } = req.body || {};
  const newText = text !== undefined ? String(text).trim() : todo.text;
  const newDone = done !== undefined ? (done ? 1 : 0) : todo.done;
  if (text !== undefined && !newText) return res.status(400).json({ error: 'text cannot be empty' });
  await db.prepare('UPDATE todos SET text=?, done=? WHERE id=?').run(newText, newDone, todo.id);
  res.json(await db.prepare('SELECT * FROM todos WHERE id=?').get(todo.id));
}));

router.delete('/todos/:id', requireAuth, ah(async (req, res) => {
  const todo = await db.prepare('SELECT * FROM todos WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!todo) return res.status(404).json({ error: 'Todo not found' });
  await db.prepare('DELETE FROM todos WHERE id=?').run(todo.id);
  res.json({ ok: true });
}));

module.exports = router;
