/* Khaliseum Chat widget — install with one script tag:
   <script src="https://YOUR-CHAT-SERVER/widget.js" data-room="community" async></script>
   Optional attrs: data-title, data-room, data-mode="embed" (full-viewport iframe mode),
   data-sw (service worker path override)
*/
(function () {
  'use strict';
  var script = document.currentScript;
  var SERVER = new URL(script.src).origin;
  var SAME_ORIGIN = location.origin === SERVER;
  var SW_PATH = script.getAttribute('data-sw') || (SERVER + '/sw.js');
  // Cross-origin embeds (e.g. Ning iframe): most browsers block notification
  // permission prompts inside cross-origin iframes, so push enrollment opens a
  // top-level /push.html tab instead. Sessions live in the chat origin's
  // localStorage, shared by the iframe and the enrollment page.
  var CROSS_ORIGIN = !SAME_ORIGIN;
  var TITLE = script.getAttribute('data-title') || 'The Khaliseum Chat';
  var DEFAULT_ROOM = script.getAttribute('data-room') || 'community';
  var EMBED = script.getAttribute('data-mode') === 'embed'; // iframe/full-page mode: no bubble, panel fills viewport

  var LS_NAME = 'khaliseum_chat_name';
  var LS_SESS = 'khaliseum_chat_sessions';

  var css = `
  #kx-chat-btn{position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:50%;
    background:#111;color:#fff;border:2px solid #e8b33c;font-size:28px;cursor:pointer;z-index:999998;
    box-shadow:0 4px 18px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center}
  #kx-chat-btn .kx-dot{position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:50%;
    background:#e33;display:none;border:2px solid #fff}
  #kx-chat-panel{position:fixed;bottom:92px;right:20px;width:360px;max-width:calc(100vw - 40px);height:520px;
    max-height:calc(100vh - 120px);background:#0f0f10;color:#eee;border:1px solid #2a2a2c;border-radius:14px;
    z-index:999999;display:none;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,sans-serif;
    box-shadow:0 12px 40px rgba(0,0,0,.5)}
  #kx-chat-panel.open{display:flex}
  .kx-head{background:#161617;padding:12px 14px;border-bottom:1px solid #2a2a2c;display:flex;align-items:center;justify-content:space-between}
  .kx-head h3{margin:0;font-size:15px;letter-spacing:.3px}
  .kx-head h3 span{color:#e8b33c}
  .kx-head button{background:none;border:none;color:#999;font-size:18px;cursor:pointer}
  .kx-tabs{display:flex;border-bottom:1px solid #2a2a2c}
  .kx-tab{flex:1;padding:10px;background:none;border:none;color:#999;font-size:13px;cursor:pointer;border-bottom:2px solid transparent}
  .kx-tab.active{color:#e8b33c;border-bottom-color:#e8b33c}
  .kx-pushrow{padding:8px 12px;border-bottom:1px solid #2a2a2c;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#aaa}
  .kx-pushrow button{background:#e8b33c;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer;color:#111}
  .kx-pushrow button:disabled{opacity:.4;cursor:default}
  #kx-chat-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
  .kx-msg{max-width:85%;padding:8px 11px;border-radius:12px;font-size:13.5px;line-height:1.4;word-wrap:break-word}
  .kx-msg .kx-n{font-size:11px;color:#e8b33c;font-weight:700;margin-bottom:2px}
  .kx-msg.them{background:#222224;align-self:flex-start;border-bottom-left-radius:4px}
  .kx-msg.me{background:#3a2f16;align-self:flex-end;border-bottom-right-radius:4px}
  .kx-msg.me .kx-n{color:#f5d67b}
  .kx-msg.deleted{opacity:.45;font-style:italic}
  .kx-form{display:flex;border-top:1px solid #2a2a2c;padding:10px;gap:8px}
  .kx-form input{flex:1;background:#1c1c1e;border:1px solid #333;color:#eee;border-radius:9px;padding:10px;font-size:13.5px;outline:none}
  .kx-form button{background:#e8b33c;border:none;border-radius:9px;padding:0 16px;font-weight:700;cursor:pointer;color:#111}
  .kx-gate{padding:24px 18px;text-align:center;font-size:13.5px;color:#bbb;display:flex;flex-direction:column;gap:10px}
  .kx-gate input{background:#1c1c1e;border:1px solid #333;color:#eee;border-radius:9px;padding:10px;font-size:13.5px;outline:none}
  .kx-gate button{background:#e8b33c;border:none;border-radius:9px;padding:10px;font-weight:700;cursor:pointer;color:#111}
  .kx-err{color:#e36;font-size:12px;min-height:16px}
  `;

  if (EMBED) {
    css += `
    #kx-chat-btn{display:none !important}
    #kx-chat-panel{position:static !important;bottom:auto;right:auto;width:100% !important;height:100vh !important;
      max-width:none !important;max-height:none !important;border-radius:0 !important;border:none !important}
    `;
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function getSessions() {
    try { return JSON.parse(localStorage.getItem(LS_SESS) || '{}'); } catch (e) { return {}; }
  }
  function saveSession(room, sess) {
    var s = getSessions(); s[room] = sess;
    try { localStorage.setItem(LS_SESS, JSON.stringify(s)); } catch (e) {}
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var state = {
    rooms: [], config: null, activeRoom: DEFAULT_ROOM,
    ws: null, sessions: getSessions(), pushState: 'unknown', // unknown|on|off|unsupported
  };

  // ---- build DOM ----
  var style = el('style', null, css);
  document.head.appendChild(style);

  var btn = el('button', null, '💬<span class="kx-dot"></span>');
  btn.id = 'kx-chat-btn';
  btn.setAttribute('aria-label', 'Open chat');
  var panel = el('div'); panel.id = 'kx-chat-panel';
  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var dot = btn.querySelector('.kx-dot');
  var open = false;

  function render() {
    panel.innerHTML = '';
    var head = el('div', 'kx-head', '<h3>' + esc(TITLE).replace('Khaliseum', '<span>Khaliseum</span>') + '</h3>');
    var close = el('button', null, '✕');
    close.onclick = toggle;
    if (EMBED) close.style.display = 'none'; // no closing in embed mode
    head.appendChild(close);
    panel.appendChild(head);

    var tabs = el('div', 'kx-tabs');
    state.rooms.forEach(function (r) {
      var t = el('button', 'kx-tab' + (r.id === state.activeRoom ? ' active' : ''), esc(r.name));
      t.onclick = function () { switchRoom(r.id); };
      tabs.appendChild(t);
    });
    panel.appendChild(tabs);

    // push opt-in row (always offered; cross-origin embeds enroll in a new tab)
    if (state.pushState !== 'unsupported') {
      var prow = el('div', 'kx-pushrow', '<span>🔔 Get notified of new messages</span>');
      var pbtn = el('button', null, state.pushState === 'on' ? 'On ✓' : (CROSS_ORIGIN ? 'Turn on ↗' : 'Turn on'));
      pbtn.disabled = state.pushState === 'on';
      pbtn.onclick = enablePush;
      prow.appendChild(pbtn);
      panel.appendChild(prow);
    }

    var sess = state.sessions[state.activeRoom];
    var room = state.rooms.find(function (r) { return r.id === state.activeRoom; });

    if (!sess || (room && room.private && sess.role !== 'team' && sess.role !== 'admin')) {
      // gate: name (+ invite code for private rooms)
      var gate = el('div', 'kx-gate');
      gate.innerHTML = '<div>' + (room && room.private
        ? '🔒 <b>Team room</b> — enter your name and team invite code.'
        : '👋 <b>Join the chat</b> — pick a display name.') + '</div>';
      var nameI = el('input'); nameI.placeholder = 'Your name';
      nameI.value = localStorage.getItem(LS_NAME) || '';
      gate.appendChild(nameI);
      var codeI = null;
      if (room && room.private) {
        codeI = el('input'); codeI.placeholder = 'Team invite code'; codeI.type = 'password';
        gate.appendChild(codeI);
      }
      var err = el('div', 'kx-err');
      var join = el('button', null, 'Join chat');
      join.onclick = function () { joinRoom(state.activeRoom, nameI.value, codeI && codeI.value, err); };
      nameI.addEventListener('keydown', function (e) { if (e.key === 'Enter') join.onclick(); });
      gate.appendChild(err);
      gate.appendChild(join);
      panel.appendChild(gate);
      return;
    }

    var msgs = el('div'); msgs.id = 'kx-chat-msgs';
    panel.appendChild(msgs);
    loadHistory(sess, msgs);

    var form = el('form', 'kx-form');
    var input = el('input'); input.placeholder = 'Message…'; input.maxLength = 1000; input.autocomplete = 'off';
    var send = el('button', null, 'Send');
    form.appendChild(input); form.appendChild(send);
    form.onsubmit = function (e) {
      e.preventDefault();
      var body = input.value.trim();
      if (!body || !state.ws || state.ws.readyState !== 1) return;
      state.ws.send(JSON.stringify({ type: 'chat', body: body }));
      input.value = '';
    };
    panel.appendChild(form);
    connectWS(sess, msgs);
  }

  function switchRoom(roomId) {
    state.activeRoom = roomId;
    if (state.ws) { try { state.ws.close(); } catch (e) {} state.ws = null; }
    render();
  }

  function joinRoom(roomId, name, inviteCode, errEl) {
    name = (name || '').trim();
    if (!name) { errEl.textContent = 'Enter a name.'; return; }
    try { localStorage.setItem(LS_NAME, name); } catch (e) {}
    fetch(SERVER + '/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, room: roomId, inviteCode: inviteCode || undefined }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { errEl.textContent = res.j.error === 'invalid invite code' ? 'Wrong invite code.' : (res.j.error || 'Could not join.'); return; }
        saveSession(roomId, res.j);
        state.sessions = getSessions();
        render();
      })
      .catch(function () { errEl.textContent = 'Connection failed.'; });
  }

  function addMsg(msgsEl, m, animate) {
    var wrap = el('div', 'kx-msg ' + (m.userId === (state.sessions[state.activeRoom] || {}).userId ? 'me' : 'them'));
    wrap.dataset.msgId = m.id;
    wrap.innerHTML = '<div class="kx-n">' + esc(m.name) + '</div><div class="kx-b">' + esc(m.body) + '</div>';
    msgsEl.appendChild(wrap);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return wrap;
  }

  function loadHistory(sess, msgsEl) {
    fetch(SERVER + '/api/rooms/' + state.activeRoom + '/history?limit=50', {
      headers: { Authorization: 'Bearer ' + sess.token },
    }).then(function (r) { return r.json(); })
      .then(function (j) {
        (j.messages || []).forEach(function (m) { addMsg(msgsEl, m); });
      })
      .catch(function () {});
  }

  function connectWS(sess, msgsEl) {
    var proto = SERVER.startsWith('https') ? 'wss' : 'ws';
    var ws = new WebSocket(proto + '://' + new URL(SERVER).host + '/ws?token=' + encodeURIComponent(sess.token) + '&room=' + state.activeRoom);
    state.ws = ws;
    ws.onmessage = function (ev) {
      var d;
      try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (d.type === 'message' && d.room === state.activeRoom) {
        addMsg(msgsEl, d);
        if (!open) { dot.style.display = 'block'; }
      } else if (d.type === 'message_deleted') {
        var n = msgsEl.querySelector('[data-msg-id="' + d.id + '"]');
        if (n) { n.classList.add('deleted'); n.querySelector('.kx-b').textContent = 'Message removed by moderator.'; }
      } else if (d.type === 'error') {
        console.warn('[khaliseum-chat]', d.error);
      }
    };
    ws.onclose = function (ev) {
      if (ev.code === 4001) {
        msgsEl.innerHTML = '';
        var g = el('div', 'kx-gate', '<div>⛔ You have been removed from this chat.</div>');
        msgsEl.appendChild(g);
      }
    };
  }

  function toggle() {
    open = !open;
    panel.classList.toggle('open', open);
    if (open) { dot.style.display = 'none'; render(); }
    else if (state.ws) { try { state.ws.close(); } catch (e) {} state.ws = null; }
  }
  btn.onclick = toggle;

  // ---- push ----
  function detectPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      state.pushState = 'unsupported';
      return;
    }
    if (CROSS_ORIGIN) { state.pushState = 'off'; return; } // enrollment + status live on /push.html
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) { state.pushState = 'off'; return; }
      return reg.pushManager.getSubscription().then(function (sub) {
        state.pushState = sub ? 'on' : 'off';
      });
    }).catch(function () { state.pushState = 'off'; });
  }

  function urlBase64ToUint8Array(base64) {
    var padding = '='.repeat((4 - (base64.length % 4)) % 4);
    var b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(b64), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function enablePush() {
    var sess = state.sessions[state.activeRoom];
    if (!sess) return;
    if (CROSS_ORIGIN) {
      // Browsers block notification prompts in cross-origin iframes, so the
      // enrollment page opens as a top-level tab at the chat origin.
      window.open(SERVER + '/push.html?room=' + encodeURIComponent(state.activeRoom), '_blank');
      return;
    }
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') return;
      return navigator.serviceWorker.register(SW_PATH, { scope: SAME_ORIGIN ? '/' : undefined })
        .then(function (reg) {
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(state.config.vapidPublicKey),
          });
        })
        .then(function (sub) {
          return fetch(SERVER + '/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sess.token },
            body: JSON.stringify({ subscription: sub.toJSON(), room: state.activeRoom }),
          });
        })
        .then(function () { state.pushState = 'on'; render(); })
        .catch(function (e) { console.warn('[khaliseum-chat] push failed', e); });
    });
  }

  // ---- boot ----
  fetch(SERVER + '/api/config')
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      state.config = cfg;
      state.rooms = cfg.rooms || [{ id: 'community', name: 'Community' }];
      if (!state.rooms.find(function (r) { return r.id === state.activeRoom; })) state.activeRoom = state.rooms[0].id;
      detectPush();
      if (EMBED && !open) toggle(); // embed mode: panel visible immediately
    })
    .catch(function () {
      state.rooms = [{ id: 'community', name: 'Community' }];
    });

  // public API for the host page
  window.KhaliseumChat = {
    open: function () { if (!open) toggle(); },
    enablePush: enablePush,
    server: SERVER,
  };
})();
