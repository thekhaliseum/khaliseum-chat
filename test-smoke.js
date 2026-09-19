// E2E smoke test for khaliseum-chat
const WebSocket = require('/home/hatch/workspace/khaliseum-chat/node_modules/ws');
const BASE = 'http://localhost:3100';

async function api(method, path, body, headers = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}
const results = [];
function check(name, cond, extra = '') {
  results.push([cond ? 'PASS' : 'FAIL', name, extra]);
  if (!cond) console.error('FAIL:', name, extra);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1. community session
  let r = await api('POST', '/api/session', { name: 'Tester1', room: 'community' });
  check('community session', r.status === 200 && r.j.token, JSON.stringify(r.j).slice(0, 80));
  const t1 = r.j;

  // 2. team room without code -> 403
  r = await api('POST', '/api/session', { name: 'Sneaky', room: 'team' });
  check('team blocked without code', r.status === 403);

  // 3. team room with wrong code -> 403
  r = await api('POST', '/api/session', { name: 'Sneaky', room: 'team', inviteCode: 'nope' });
  check('team blocked with wrong code', r.status === 403);

  // 4. team room with code -> ok, role team
  r = await api('POST', '/api/session', { name: 'Teammate', room: 'team', inviteCode: 'team-secret' });
  check('team session with code', r.status === 200 && r.j.role === 'team');
  const t2 = r.j;

  // 5. second community user
  r = await api('POST', '/api/session', { name: 'Tester2', room: 'community' });
  const t3 = r.j;
  check('second community session', r.status === 200);

  // 6. WS realtime: t1 sends, t3 receives
  const ws1 = new WebSocket(`ws://localhost:3100/ws?token=${t1.token}&room=community`);
  const ws3 = new WebSocket(`ws://localhost:3100/ws?token=${t3.token}&room=community`);
  await Promise.all([
    new Promise((res) => ws1.on('open', res)),
    new Promise((res) => ws3.on('open', res)),
  ]);
  check('ws connect x2', true);
  const got = new Promise((res) => ws3.on('message', (d) => res(JSON.parse(d))));
  ws1.send(JSON.stringify({ type: 'chat', body: 'hello from tester1' }));
  const m = await got;
  check('realtime delivery', m.type === 'message' && m.body === 'hello from tester1' && m.name === 'Tester1', JSON.stringify(m).slice(0, 100));
  const msgId = m.id;

  // 7. history contains it
  r = await api('GET', `/api/rooms/community/history`, null, { Authorization: 'Bearer ' + t1.token });
  check('history has message', r.j.messages.some((x) => x.id === msgId));

  // 8. admin login + delete -> deletion event received
  r = await api('POST', '/api/admin/login', { password: 'test-admin-123' });
  check('admin login', r.status === 200 && r.j.adminToken);
  const adm = r.j.adminToken;
  const delEv = new Promise((res) => ws3.on('message', (d) => { const p = JSON.parse(d); if (p.type === 'message_deleted') res(p); }));
  r = await api('DELETE', `/api/admin/messages/${msgId}`, null, { 'X-Admin-Token': adm });
  check('admin delete', r.status === 200 && r.j.ok);
  const del = await delEv;
  check('delete event broadcast', del.id === msgId);

  // 9. history no longer has it
  r = await api('GET', `/api/rooms/community/history`, null, { Authorization: 'Bearer ' + t1.token });
  check('history excludes deleted', !r.j.messages.some((x) => x.id === msgId));

  // 10. ban t3 -> ws closed with 4001
  const banClose = new Promise((res) => ws3.on('close', (code) => res(code)));
  r = await api('POST', '/api/admin/ban', { userId: t3.userId, banned: true }, { 'X-Admin-Token': adm });
  check('ban ok', r.j.ok);
  const code = await banClose;
  check('banned socket closed', code === 4001, 'code=' + code);

  // 11. banned user can't get new session history
  r = await api('GET', `/api/rooms/community/history`, null, { Authorization: 'Bearer ' + t3.token });
  check('banned blocked from api', r.status === 403);

  // 12. unban works
  r = await api('POST', '/api/admin/ban', { userId: t3.userId, banned: false }, { 'X-Admin-Token': adm });
  check('unban ok', r.j.ok);

  // 13. broadcast (no push subs -> sent 0, still ok)
  r = await api('POST', '/api/admin/broadcast', { title: 'LIVE', body: 'we are live', url: 'https://kick.com/x' }, { 'X-Admin-Token': adm });
  check('broadcast ok', r.status === 200 && r.j.ok, JSON.stringify(r.j));

  // 14. team user cannot read community-gated? (member can't access team history)
  r = await api('GET', `/api/rooms/team/history`, null, { Authorization: 'Bearer ' + t1.token });
  check('member blocked from team history', r.status === 403);
  r = await api('GET', `/api/rooms/team/history`, null, { Authorization: 'Bearer ' + t2.token });
  check('team member reads team history', r.status === 200);

  ws1.close();

  // 15. image upload (fresh users, since t3 was banned earlier — now unbanned, fine)
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const pngBuf = Buffer.from(pngB64, 'base64');
  async function upload(file, name, type, token) {
    const fd = new FormData();
    fd.append('image', new File([file], name, { type }));
    const r = await fetch(BASE + '/api/upload', {
      method: 'POST',
      headers: token ? { Authorization: 'Bearer ' + token } : {},
      body: fd,
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  }
  r = await upload(pngBuf, 'pic.png', 'image/png', t1.token);
  check('image upload ok', r.status === 200 && /^\/uploads\/[A-Za-z0-9]+\.png$/.test(r.j.url), JSON.stringify(r.j));
  const imgUrl = r.j.url;

  // 16. non-image upload rejected
  r = await upload(Buffer.from('hello'), 'evil.txt', 'text/plain', t1.token);
  check('non-image upload rejected', r.status === 400);

  // 17. unauthenticated upload rejected
  r = await upload(pngBuf, 'pic.png', 'image/png', null);
  check('upload requires auth', r.status === 401);

  // 18. image message over WS: broadcast + history carry imageUrl
  const wsA = new WebSocket(`ws://localhost:3100/ws?token=${t1.token}&room=community`);
  await new Promise((res) => wsA.on('open', res));
  const gotImg = new Promise((res) => wsA.on('message', (d) => { const p = JSON.parse(d); if (p.type === 'message') res(p); }));
  wsA.send(JSON.stringify({ type: 'chat', body: 'look at this', imageUrl: imgUrl }));
  const im = await gotImg;
  check('image message broadcast', im.imageUrl === imgUrl && im.body === 'look at this');
  const imgMsgId = im.id;
  r = await api('GET', '/api/rooms/community/history', null, { Authorization: 'Bearer ' + t1.token });
  check('history has imageUrl (widget-compatible name)', r.j.messages.some((x) => x.id === imgMsgId && x.imageUrl === imgUrl));
  check('history has userId (widget-compatible name)', r.j.messages.some((x) => x.id === imgMsgId && x.userId === t1.userId));

  // 19. spoofed imageUrl rejected (not a server upload path)
  const gotSpoof = new Promise((res) => wsA.on('message', (d) => { const p = JSON.parse(d); if (p.type === 'message') res(p); }));
  wsA.send(JSON.stringify({ type: 'chat', body: 'spoof attempt', imageUrl: 'https://evil.example/x.png' }));
  const sp = await gotSpoof;
  check('spoofed imageUrl stripped', sp.imageUrl === null && sp.body === 'spoof attempt');

  // 20. user deletes own message
  const delEv2 = new Promise((res) => wsA.on('message', (d) => { const p = JSON.parse(d); if (p.type === 'message_deleted') res(p); }));
  r = await api('DELETE', `/api/messages/${imgMsgId}`, null, { Authorization: 'Bearer ' + t1.token });
  check('own delete ok', r.status === 200 && r.j.ok);
  const del2 = await delEv2;
  check('own delete broadcast', del2.id === imgMsgId);
  r = await api('GET', '/api/rooms/community/history', null, { Authorization: 'Bearer ' + t1.token });
  check('own-deleted excluded from history', !r.j.messages.some((x) => x.id === imgMsgId));

  // 21. cannot delete someone else's message (t1's new message, t3 tries)
  const gotOther = new Promise((res) => wsA.on('message', (d) => { const p = JSON.parse(d); if (p.type === 'message') res(p); }));
  wsA.send(JSON.stringify({ type: 'chat', body: 'not yours' }));
  const other = await gotOther;
  r = await api('DELETE', `/api/messages/${other.id}`, null, { Authorization: 'Bearer ' + t3.token });
  check('delete other user message -> 403', r.status === 403);
  r = await api('DELETE', `/api/messages/${other.id}`, null, {});
  check('delete unauthenticated -> 401', r.status === 401);
  r = await api('DELETE', '/api/messages/does-not-exist', null, { Authorization: 'Bearer ' + t1.token });
  check('delete missing -> 404', r.status === 404);

  wsA.close();

  // 22. stale session recovery: simulate a deploy wipe (free tier restarts
  // clear the DB, invalidating tokens stored in browsers)
  const path = require('path');
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  const dbWipe = require('better-sqlite3')(path.join(dataDir, 'chat.db'));
  dbWipe.exec('DELETE FROM users');
  dbWipe.close();
  r = await api('GET', '/api/rooms/community/history', null, { Authorization: 'Bearer ' + t1.token });
  check('stale token history -> 401', r.status === 401);
  r = await upload(pngBuf, 'pic.png', 'image/png', t1.token);
  check('stale token upload -> 401', r.status === 401);
  r = await api('DELETE', '/api/messages/does-not-exist', null, { Authorization: 'Bearer ' + t1.token });
  check('stale token delete -> 401', r.status === 401);
  const wsDead = new WebSocket(`ws://localhost:3100/ws?token=${t1.token}&room=community`);
  const deadCode = await new Promise((res) => {
    wsDead.on('close', (code) => res(code));
    setTimeout(() => res('timeout'), 8000);
  });
  check('stale token WS -> 4000', deadCode === 4000, String(deadCode));
  const wjs = require('fs').readFileSync(path.join(__dirname, 'public', 'widget.js'), 'utf8');
  check('widget recovers from dead session', wjs.includes('dropStaleSession')
    && /res\.status === 401/.test(wjs) && /ev\.code === 4000/.test(wjs));

  console.log('\n--- results ---');
  results.forEach(([s, n, e]) => console.log(s, n, e));
  const fails = results.filter(([s]) => s === 'FAIL').length;
  console.log(fails === 0 ? 'ALL TESTS PASSED' : fails + ' FAILURES');
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
