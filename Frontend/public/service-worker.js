/* Service Worker for Web Push */
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', event => {
  let data = {};
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    console.warn('[ServiceWorker] Push event data was not JSON:', e);
    data = { 
      title: 'Attendance Alert', 
      body: event.data ? event.data.text() : 'You have a new notification.' 
    };
  }
  
  const title = data.title || 'Attendance Notification';
  const options = {
    body: data.body || 'You have a new notification.',
    icon: '/Logo.png',
    badge: '/Logo.png',
    data: data.data || {},
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open', title: 'Open Website' }
    ]
  };
  
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const urlToOpen = new URL('/', self.location.origin).href;
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
