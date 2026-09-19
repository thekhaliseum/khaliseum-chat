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
  console.log('\n--- results ---');
  results.forEach(([s, n, e]) => console.log(s, n, e));
  const fails = results.filter(([s]) => s === 'FAIL').length;
  console.log(fails === 0 ? 'ALL TESTS PASSED' : fails + ' FAILURES');
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
