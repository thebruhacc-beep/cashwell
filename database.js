// database.js — Turso (libSQL) client.
//
// Turso is a free, hosted, SQLite-compatible database (https://turso.tech).
// It replaces the old node:sqlite / better-sqlite3 setup so the app no
// longer depends on a writable local disk — which is exactly what broke on
// Railway/Render's ephemeral filesystems.
//
// Locally (no Turso account yet) it transparently falls back to a plain
// SQLite file on disk, so `npm run dev` still works with zero setup.
//
// In production, set two env vars (from the Turso dashboard/CLI):
//   TURSO_DATABASE_URL   e.g. libsql://neonfinance-yourname.turso.io
//   TURSO_AUTH_TOKEN     long-lived auth token for that database
const path = require('path');
const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, 'neonfinance.db')}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

console.log(`📁 Database: ${authToken ? url : 'local file (' + url + ')'}`);

const client = createClient(authToken ? { url, authToken } : { url });

// Normalizes libSQL's Row objects into plain JS objects so JSON.stringify
// and property access (row.username, etc.) always behave predictably.
function toObject(row, columns) {
  const obj = {};
  columns.forEach((col, i) => { obj[col] = row[i]; });
  return obj;
}

// Thin wrapper that mirrors the old better-sqlite3 / node:sqlite call shape
// (db.prepare(sql).get/all/run(...args)), but async — every call site needs
// `await`. See routes.js and server.js for the converted usage.
const db = {
  exec: async (sql) => { await client.executeMultiple(sql); },
  prepare: (sql) => ({
    get: async (...args) => {
      const r = await client.execute({ sql, args });
      return r.rows.length ? toObject(r.rows[0], r.columns) : undefined;
    },
    all: async (...args) => {
      const r = await client.execute({ sql, args });
      return r.rows.map(row => toObject(row, r.columns));
    },
    run: async (...args) => {
      const r = await client.execute({ sql, args });
      return r;
    },
  }),
};

async function initDb() {
  await db.exec(`
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
      retention  TEXT DEFAULT 'daily',
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
      asset   TEXT DEFAULT NULL,
      hidden  INTEGER NOT NULL DEFAULT 0,
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
      saved      INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS poll_votes (
      message_id TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      option_idx INTEGER NOT NULL,
      PRIMARY KEY (message_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS todos (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      text       TEXT NOT NULL,
      done       INTEGER NOT NULL DEFAULT 0,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS month_winrate (
      user_id TEXT NOT NULL,
      month   TEXT NOT NULL,  -- 'YYYY-MM'
      wins    INTEGER NOT NULL DEFAULT 0,
      losses  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, month)
    );
    CREATE TABLE IF NOT EXISTS strategies (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      data       TEXT NOT NULL,  -- JSON: {icon,color,description,branches:[{id,name,checklist:[{id,text}]}]}
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Migration for databases created before the `asset` column existed
  // (CREATE TABLE IF NOT EXISTS above won't add it to an existing table).
  try {
    await client.execute('ALTER TABLE wallet_types ADD COLUMN asset TEXT DEFAULT NULL');
    console.log('🔧 Migrated: added wallet_types.asset column');
  } catch (e) {
    // Already exists — fine, ignore.
  }

  // Migration for databases created before chat retention / saved messages existed.
  try {
    await client.execute("ALTER TABLE groups_table ADD COLUMN retention TEXT DEFAULT 'daily'");
    console.log('🔧 Migrated: added groups_table.retention column');
  } catch (e) {
    // Already exists — fine, ignore.
  }
  try {
    await client.execute('ALTER TABLE messages ADD COLUMN saved INTEGER NOT NULL DEFAULT 0');
    console.log('🔧 Migrated: added messages.saved column');
  } catch (e) {
    // Already exists — fine, ignore.
  }
  try {
    await client.execute('ALTER TABLE wallet_types ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
    console.log('🔧 Migrated: added wallet_types.hidden column');
  } catch (e) {
    // Already exists — fine, ignore.
  }

  console.log('✅ Database ready');
}

db.initDb = initDb;
module.exports = db;
