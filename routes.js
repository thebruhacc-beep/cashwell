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
  res.json(await db.prepare('SELECT name,balance FROM wallet_types WHERE user_id=?').all(req.user.id));
}));

router.put('/wallet/:name', requireAuth, ah(async (req, res) => {
  const { balance } = req.body || {};
  await db.prepare('INSERT INTO wallet_types (user_id,name,balance) VALUES (?,?,?) ON CONFLICT(user_id,name) DO UPDATE SET balance=excluded.balance')
    .run(req.user.id, req.params.name, Number(balance) || 0);
  res.json({ ok: true });
}));

router.post('/wallet', requireAuth, ah(async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  await db.prepare('INSERT OR IGNORE INTO wallet_types (user_id,name,balance) VALUES (?,?,0)').run(req.user.id, name);
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

router.get('/messages', requireAuth, ah(async (req, res) => {
  const gid = await userGroupId(req.user.id);
  if (!gid) return res.json([]);

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

module.exports = router;
