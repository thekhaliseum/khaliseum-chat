// Database layer — SQLite via better-sqlite3
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'chat.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',   -- member | team | admin
    banned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    room TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room, created_at);
  CREATE TABLE IF NOT EXISTS push_subs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    room TEXT NOT NULL,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const get = (key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
};
const set = (key, value) => {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
};

module.exports = {
  db, get, set,

  createUser: (id, name, token, role) =>
    db.prepare('INSERT INTO users (id, name, token, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, token, role, Date.now()),

  getUserByToken: (token) =>
    db.prepare('SELECT * FROM users WHERE token = ?').get(token),

  getUserById: (id) =>
    db.prepare('SELECT * FROM users WHERE id = ?').get(id),

  setBanned: (id, banned) =>
    db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(banned ? 1 : 0, id),

  listUsers: (limit = 100) =>
    db.prepare('SELECT id, name, role, banned, created_at FROM users ORDER BY created_at DESC LIMIT ?').all(limit),

  addMessage: (id, room, userId, name, body) =>
    db.prepare('INSERT INTO messages (id, room, user_id, name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, room, userId, name, body, Date.now()),

  history: (room, limit = 50, before = null) => {
    if (before) {
      return db.prepare(`SELECT id, room, user_id, name, body, created_at FROM messages
        WHERE room = ? AND deleted = 0 AND created_at < ? ORDER BY created_at DESC LIMIT ?`).all(room, before, limit).reverse();
    }
    return db.prepare(`SELECT id, room, user_id, name, body, created_at FROM messages
      WHERE room = ? AND deleted = 0 ORDER BY created_at DESC LIMIT ?`).all(room, limit).reverse();
  },

  recentMessages: (limit = 100, room = null) => {
    if (room) {
      return db.prepare(`SELECT id, room, user_id, name, body, created_at, deleted FROM messages
        WHERE room = ? ORDER BY created_at DESC LIMIT ?`).all(room, limit).reverse();
    }
    return db.prepare(`SELECT id, room, user_id, name, body, created_at, deleted FROM messages
      ORDER BY created_at DESC LIMIT ?`).all(limit).reverse();
  },

  deleteMessage: (id) =>
    db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(id),

  getMessage: (id) =>
    db.prepare('SELECT * FROM messages WHERE id = ?').get(id),

  upsertPushSub: (id, userId, room, sub) =>
    db.prepare(`INSERT INTO push_subs (id, user_id, room, endpoint, p256dh, auth, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, room = excluded.room,
        p256dh = excluded.p256dh, auth = excluded.auth`)
      .run(id, userId, room, sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now()),

  removePushSub: (endpoint) =>
    db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint),

  subsForRoom: (room, excludeUserId = null) => {
    if (excludeUserId) {
      return db.prepare('SELECT * FROM push_subs WHERE room = ? AND user_id != ?').all(room, excludeUserId);
    }
    return db.prepare('SELECT * FROM push_subs WHERE room = ?').all(room);
  },

  allSubs: () => db.prepare('SELECT * FROM push_subs').all(),
};
