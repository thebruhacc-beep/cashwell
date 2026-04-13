// database.js — Node 22+ built-in sqlite, falls back to better-sqlite3
// Railway/Render: uses /tmp for writable storage, or in-memory if not available
const path = require('path');

// On Railway/Render the app directory is read-only after deploy
// Use /tmp which is always writable, or fall back to memory-only
const DB_PATH = process.env.DB_PATH ||
  (process.env.RAILWAY_ENVIRONMENT || process.env.RENDER ? '/tmp/neonfinance.db' : path.join(__dirname, 'neonfinance.db'));

console.log(`📁 Database path: ${DB_PATH}`);

let db;

try {
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(DB_PATH);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db = {
    exec:    sql  => { raw.exec(sql); return db; },
    prepare: sql  => {
      const stmt = raw.prepare(sql);
      return {
        get:  (...a) => { try { return stmt.get(...a) || undefined; } catch { return undefined; } },
        all:  (...a) => { try { return stmt.all(...a); } catch { return []; } },
        run:  (...a) => { try { stmt.run(...a); } catch(e) { throw e; } return {}; },
      };
    },
  };
  console.log('✅ Database: node:sqlite (built-in)');
} catch {
  try {
    const BetterSqlite = require('better-sqlite3');
    const raw = new BetterSqlite(DB_PATH);
    raw.pragma('journal_mode = WAL');
    raw.pragma('foreign_keys = ON');
    db = { exec: sql => { raw.exec(sql); return db; }, prepare: sql => raw.prepare(sql) };
    console.log('✅ Database: better-sqlite3');
  } catch(e) {
    console.error('❌ No SQLite driver. Use Node 22+ or install better-sqlite3.');
    process.exit(1);
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    username     TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password     TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar       TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS groups_table (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    code       TEXT UNIQUE NOT NULL,
    admin_id   TEXT NOT NULL,
    paypal     TEXT DEFAULT '',
    pay_note   TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS group_members (
    group_id  TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (group_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    amount     REAL NOT NULL,
    category   TEXT NOT NULL,
    wallet     TEXT NOT NULL,
    date       TEXT NOT NULL,
    note       TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS wallet_types (
    user_id TEXT NOT NULL,
    name    TEXT NOT NULL,
    balance REAL DEFAULT 0,
    PRIMARY KEY (user_id, name)
  );
  CREATE TABLE IF NOT EXISTS categories (
    user_id TEXT NOT NULL,
    name    TEXT NOT NULL,
    PRIMARY KEY (user_id, name)
  );
  CREATE TABLE IF NOT EXISTS deposits (
    id           TEXT PRIMARY KEY,
    group_id     TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    username     TEXT NOT NULL,
    amount       REAL NOT NULL,
    source       TEXT NOT NULL,
    method       TEXT NOT NULL,
    note         TEXT DEFAULT '',
    date         TEXT NOT NULL,
    status       TEXT DEFAULT 'pending',
    created_at   TEXT NOT NULL,
    confirmed_at TEXT,
    cancelled_at TEXT
  );
  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    group_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    username   TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'text',
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS poll_votes (
    message_id TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    option_idx INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id)
  );
`);

module.exports = db;
