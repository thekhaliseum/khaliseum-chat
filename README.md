# Khaliseum Chat 💬

Your own embeddable website messenger — realtime chat, push notifications,
a private team room, and a moderation panel where you can delete any
disruptive message instantly.

## What you got

| Feature | How |
|---|---|
| **Installs on your site** | One `<script>` tag — a chat bubble appears bottom-right |
| **Push notifications** | Visitors tap "Turn on" → they get notified of new messages even with the tab closed |
| **Call-back blasts** | From the admin panel, send one push to everyone ("🔴 LIVE on Kick now") to pull people back to your site/stream |
| **Private team room** | Locked `Team 🔒` tab — only people with your invite code get in |
| **Moderation** | Admin panel: delete any message (vanishes for everyone live), ban/unban users instantly |

## Quick start (try it now)

```bash
cd khaliseum-chat
npm install
ADMIN_PASSWORD=pick-something-strong TEAM_INVITE_CODE=pick-a-code \
PUBLIC_URL=http://localhost:3000 node server/server.js
```

- Demo site: http://localhost:3000/demo.html (open in 2 tabs to see realtime sync)
- Admin panel: http://localhost:3000/admin.html

## Install it on your website

Add this one line before `</body>`, with `src` pointing at wherever you host the chat server:

```html
<script src="https://chat.yourdomain.com/widget.js" data-title="The Khaliseum Chat" async></script>
```

Optional attributes:
- `data-room="community"` — which tab opens first
- `data-title="..."` — header text
- `data-sw="/sw.js"` — only needed for push if the chat server is on a **different** domain than your site (see below)

## Push notifications — one important detail

Web Push requires the service worker to live on **your website's own domain**.
Two setups:

**A. Same-origin (recommended, push works out of the box).**
Serve the chat server from a path on your domain, e.g. `thekhaliseum.com/chat/`,
via a reverse proxy. Example nginx:

```nginx
location /chat/ {
  proxy_pass http://127.0.0.1:3000/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";   # websockets
}
```

Then embed with `<script src="https://thekhaliseum.com/chat/widget.js" ...>`.
Push opt-in just works.

**B. Chat on its own domain (e.g. `chat.yourdomain.com`).**
Chat works fine, but for push: copy `public/sw.js` to your website as `/sw.js`
and add `data-sw="/sw.js"` to the script tag.

Notes:
- Push needs **HTTPS** in production (works on `localhost` for testing).
- On iPhone, web push only arrives if the visitor taps **Share → Add to Home Screen** first (Apple's rule, not ours). Android + desktop work straight from the browser.

## Moderation (delete disruptive messages)

1. Open `/admin.html`, sign in with your `ADMIN_PASSWORD`.
2. **Messages tab** — see everything recent, hit **Delete** on anything you don't like.
   It's removed for every viewer instantly.
3. **Users tab** — **Ban** someone and they're disconnected immediately and can't rejoin.

## Call people back (push blasts)

Admin panel → **📣 Call-back blast** tab → write a title + message + link → Send.
Everyone who opted into notifications gets it, even with your site closed.
Perfect for "🔴 We're LIVE on Kick right now — tap in."

## Team room

The `Team 🔒` tab asks for your `TEAM_INVITE_CODE`. Only share that code with
your team. Team messages never appear in the public room.

## Deploy it (pick one)

### Your setup: Ning (thekhaliseum.com) — recommended path

Your site runs on Ning, which can't host a Node server, so the chat backend
lives on a small external host (free tier works) at `chat.thekhaliseum.com`,
and embeds into your Ning pages. Push enrollment happens from the embed:
visitors tap "Turn on" and a one-time tab opens on the chat server to approve
notifications (browsers block the permission prompt inside cross-origin
iframes). After that, call-back blasts reach them even when your site is closed.

**1. Host the chat server (Render, ~5 minutes, free)**
- Push this `khaliseum-chat` folder to a GitHub repo (or I can walk you through it).
- On [render.com](https://render.com): New → Web Service → connect the repo.
  - Build command: `npm install` · Start command: `node server/server.js`
  - Add a **persistent disk** mounted at `/opt/render/project/src/data` (this keeps
    chat history + push subscriptions across deploys; without it they reset).
  - Environment variables: `ADMIN_PASSWORD`, `TEAM_INVITE_CODE`, `PUBLIC_URL=https://chat.thekhaliseum.com`
- You get a URL like `khaliseum-chat.onrender.com`.

**2. Point `chat.thekhaliseum.com` at it**
- In your domain's DNS (wherever thekhaliseum.com is registered), add:
  `CNAME  chat  →  khaliseum-chat.onrender.com`
- In Render: Settings → Custom Domains → add `chat.thekhaliseum.com`.

**3. Embed it in Ning**
- Ning Dashboard → Design Studio → Custom Code (available on paid Ning plans).
- Paste this where you want the chat (a page, sidebar, or site-wide footer):

```html
<iframe src="https://chat.thekhaliseum.com/embed.html"
        style="width:100%;height:600px;border:0;border-radius:12px"></iframe>
```

Visitors tap "Turn on" in the embed once — a new tab opens on the chat server
where they approve notifications (browsers block the permission prompt inside
cross-origin iframes). After that, your call-back blasts reach them even when
your site is closed.

**Alternative — floating bubble overlay instead of a fixed iframe:** paste
this instead (chat works; the push opt-in opens the same enrollment tab):

```html
<script src="https://chat.thekhaliseum.com/widget.js" data-title="The Khaliseum Chat" async></script>
```

### Other hosts

- **Railway / Fly.io** — same idea as Render above.
- **VPS (DigitalOcean etc.)** — `node server/server.js` behind nginx (see proxy
  snippet above) + a process manager like `pm2`.
- **Your existing site host** — if it runs Node, drop this folder in and proxy `/chat/`.

### Environment variables

| Var | Required | What |
|---|---|---|
| `PORT` | no (default 3000) | Port to listen on |
| `ADMIN_PASSWORD` | **yes** | Password for `/admin.html` — change from the default |
| `TEAM_INVITE_CODE` | **yes** | Secret code for the Team 🔒 room |
| `PUBLIC_URL` | yes for push | Full public URL, e.g. `https://thekhaliseum.com` — where push taps land |

## Honest security notes

- This is a **self-hosted community chat**, not end-to-end encrypted like Signal.
  You (the server owner) can read messages — that's what makes moderation possible.
  Don't use the team room for anything you wouldn't trust a server admin to see.
- Rate limiting is built in; for a big public launch put it behind Cloudflare.
- Back up `data/chat.db` — that's your whole chat history.
