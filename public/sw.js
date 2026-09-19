// Khaliseum Chat service worker — handles push notifications.
// Same-origin deploy: this file is served from the chat server root.
// Cross-origin deploy: host a copy of this file on YOUR website (e.g. /sw.js)
// and pass data-sw="/sw.js" on the widget script tag.
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  var title = data.title || 'The Khaliseum';
  var options = {
    body: data.body || 'New message',
    icon: '/icon.png',
    badge: '/icon.png',
    tag: data.tag || 'khaliseum-chat',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (wins) {
      for (var i = 0; i < wins.length; i++) {
        try {
          if (new URL(wins[i].url).origin === new URL(url, wins[i].url).origin) {
            wins[i].navigate(url);
            return wins[i].focus();
          }
        } catch (e) {}
      }
      return clients.openWindow(url);
    })
  );
});
