// Khaliseum Chat server — realtime chat + push + moderation
// Run:  ADMIN_PASSWORD=... TEAM_INVITE_CODE=... PUBLIC_URL=https://chat.example.com node server/server.js
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const webpush = require('web-push');
const store = require('./db');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'khaliseum-admin';
const TEAM_INVITE_CODE = process.env.TEAM_INVITE_CODE || 'team-1234';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

if (!process.env.ADMIN_PASSWORD) {
  console.warn('[warn] ADMIN_PASSWORD not set — using default "khaliseum-admin". Change it before going live.');
}
if (!process.env.TEAM_INVITE_CODE) {
  console.warn('[warn] TEAM_INVITE_CODE not set — using default "team-1234". Change it before going live.');
}

// ---- VAPID (push) keys: generated once, stored in db ----
let vapid = store.get('vapid');
if (!vapid) {
  vapid = webpush.generateVAPIDKeys();
  store.set('vapid', JSON.stringify(vapid));
  console.log('[push] generated new VAPID keys');
} else {
  vapid = JSON.parse(vapid);
}
webpush.setVapidDetails('mailto:admin@thekhaliseum.com', vapid.publicKey, vapid.privateKey);

const ROOMS = [
  { id: 'community', name: 'Community', private: false },
  { id: 'team', name: 'Team 🔒', private: true },
];
const roomById = (id) => ROOMS.find((r) => r.id === id);
const canAccess = (user, roomId) => {
  if (roomId === 'community') return true;
  return user && (user.role === 'team' || user.role === 'admin');
};

const app = express();
app.use(express.json({ limit: '64kb' }));

// CORS — the widget is embedded on other sites, tokens travel in headers/body (no cookies)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---- simple in-memory rate limiting ----
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || [];
  const fresh = b.filter((t) => now - t < windowMs);
  fresh.push(now);
  buckets.set(key, fresh);
  return fresh.length <= max;
}
const ip = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

// ---- static files ----
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (req, res) => res.json({ ok: true, rooms: ROOMS.map((r) => r.id) }));

app.get('/api/config', (req, res) => {
  res.json({ vapidPublicKey: vapid.publicKey, rooms: ROOMS });
});

// ---- sessions ----
app.post('/api/session', (req, res) => {
  if (!rateLimit('sess:' + ip(req), 30, 60_000)) return res.status(429).json({ error: 'slow down' });
  const { name, room = 'community', inviteCode } = req.body || {};
  const cleanName = String(name || '').trim().slice(0, 40);
  if (!cleanName) return res.status(400).json({ error: 'name required' });
  const r = roomById(room);
  if (!r) return res.status(400).json({ error: 'unknown room' });

  let role = 'member';
  if (r.private) {
    if (inviteCode !== TEAM_INVITE_CODE) return res.status(403).json({ error: 'invalid invite code' });
    role = 'team';
  }
  const id = crypto.randomUUID();
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  store.createUser(id, cleanName, token, role);
  res.json({ token, userId: id, name: cleanName, role, room: r.id });
});

const authUser = (req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const user = token && store.getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (user.banned) return res.status(403).json({ error: 'banned' });
  req.user = user;
  next();
};

app.get('/api/rooms/:room/history', authUser, (req, res) => {
  const { room } = req.params;
  if (!roomById(room) || !canAccess(req.user, room)) return res.status(403).json({ error: 'no access' });
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const before = req.query.before ? parseInt(req.query.before) : null;
  res.json({ messages: store.history(room, limit, before) });
});

// ---- push subscriptions ----
app.post('/api/push/subscribe', authUser, (req, res) => {
  const { subscription, room } = req.body || {};
  if (!subscription?.endpoint || !subscription?.keys) return res.status(400).json({ error: 'bad subscription' });
  if (!roomById(room) || !canAccess(req.user, room)) return res.status(403).json({ error: 'no access' });
  store.upsertPushSub(crypto.randomUUID(), req.user.id, room, subscription);
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', authUser, (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) store.removePushSub(endpoint);
  res.json({ ok: true });
});

// ---- admin ----
const adminTokens = new Set();
app.post('/api/admin/login', (req, res) => {
  if (!rateLimit('admin:' + ip(req), 10, 60_000)) return res.status(429).json({ error: 'slow down' });
  if (req.body?.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'wrong password' });
  const t = 'adm_' + crypto.randomUUID().replace(/-/g, '');
  adminTokens.add(t);
  res.json({ adminToken: t });
});
const authAdmin = (req, res, next) => {
  const t = req.headers['x-admin-token'];
  if (!t || !adminTokens.has(t)) return res.status(401).json({ error: 'admin unauthorized' });
  next();
};

app.get('/api/admin/messages', authAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  res.json({ messages: store.recentMessages(limit, req.query.room || null), rooms: ROOMS });
});

app.delete('/api/admin/messages/:id', authAdmin, (req, res) => {
  const msg = store.getMessage(req.params.id);
  if (!msg) return res.status(404).json({ error: 'not found' });
  store.deleteMessage(msg.id);
  broadcastToRoom(msg.room, { type: 'message_deleted', id: msg.id, room: msg.room });
  res.json({ ok: true });
});

app.get('/api/admin/users', authAdmin, (req, res) => {
  res.json({ users: store.listUsers(200) });
});

app.post('/api/admin/ban', authAdmin, (req, res) => {
  const { userId, banned = true } = req.body || {};
  const u = store.getUserById(userId);
  if (!u) return res.status(404).json({ error: 'not found' });
  store.setBanned(userId, banned);
  // close their live sockets
  for (const [ws, meta] of sockets) {
    if (meta.userId === userId) ws.close(4001, 'banned');
  }
  res.json({ ok: true });
});

// "Call back" blast: push notification to subscribers (all rooms, or one room)
app.post('/api/admin/broadcast', authAdmin, async (req, res) => {
  const { title, body, url, room } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });
  const subs = room ? store.subsForRoom(room) : store.allSubs();
  const payload = JSON.stringify({
    title: String(title).slice(0, 80),
    body: String(body).slice(0, 200),
    url: url || PUBLIC_URL || '/',
    tag: 'khaliseum-broadcast',
  });
  let sent = 0, failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      failed++;
      if (e.statusCode === 404 || e.statusCode === 410) store.removePushSub(s.endpoint);
    }
  }));
  res.json({ ok: true, sent, failed, audience: subs.length });
});

// ---- websocket ----
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const sockets = new Map(); // ws -> { userId, name, role, room }

function broadcastToRoom(room, data, except = null) {
  const payload = JSON.stringify(data);
  for (const [ws, meta] of sockets) {
    if (ws !== except && ws.readyState === 1 && meta.room === room) ws.send(payload);
  }
}

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  const user = token && store.getUserByToken(token);
  if (!user || user.banned) return ws.close(4000, 'unauthorized');

  const room = new URL(req.url, 'http://x').searchParams.get('room') || 'community';
  if (!roomById(room) || !canAccess(user, room)) return ws.close(4003, 'no access');

  sockets.set(ws, { userId: user.id, name: user.name, role: user.role, room });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const meta = sockets.get(ws);
    if (!meta) return;
    const fresh = store.getUserById(meta.userId);
    if (!fresh || fresh.banned) return ws.close(4001, 'banned');

    if (msg.type === 'chat') {
      if (!rateLimit('msg:' + meta.userId, 20, 60_000)) {
        return ws.send(JSON.stringify({ type: 'error', error: 'slow down' }));
      }
      const body = String(msg.body || '').trim().slice(0, 1000);
      if (!body) return;
      const id = crypto.randomUUID();
      store.addMessage(id, meta.room, meta.userId, meta.name, body);
      const out = { type: 'message', id, room: meta.room, userId: meta.userId, name: meta.name, body, created_at: Date.now() };
      broadcastToRoom(meta.room, out);
      notifyRoom(meta.room, meta.userId, meta.name, body);
    }
  });

  ws.on('close', () => sockets.delete(ws));
});

// push notify room subscribers (except the author)
async function notifyRoom(room, excludeUserId, name, body) {
  const subs = store.subsForRoom(room, excludeUserId);
  if (!subs.length) return;
  const r = roomById(room);
  const payload = JSON.stringify({
    title: `💬 ${name} — ${r.name} | The Khaliseum`,
    body: body.slice(0, 140),
    url: PUBLIC_URL || '/',
    tag: `khaliseum-${room}`,
  });
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) store.removePushSub(s.endpoint);
    }
  }));
}

server.listen(PORT, () => {
  console.log(`[khaliseum-chat] listening on :${PORT}`);
  console.log(`[khaliseum-chat] admin panel: http://localhost:${PORT}/admin.html`);
  console.log(`[khaliseum-chat] demo:        http://localhost:${PORT}/demo.html`);
});
