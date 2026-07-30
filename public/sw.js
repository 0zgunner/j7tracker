// J7Tracker service worker - handles incoming push notifications so
// alerts can reach you even when the tab/browser is closed.

self.addEventListener('push', (event) => {
  let payload = { title: 'J7Tracker', body: 'You have a new alert.' };
  try {
    if (event.data) payload = event.data.json();
  } catch (err) {
    // Non-JSON push payload, fall back to default text above.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'J7Tracker', {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
