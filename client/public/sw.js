self.addEventListener('push', function(event) {
  const options = {
    body: event.data ? event.data.text() : 'Your order is ready for pickup!',
    icon: '/vite.svg', // Change this to your cafe's logo later!
    badge: '/vite.svg',
    vibrate: [1000, 500, 1000, 500, 2000],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    }
  };

  event.waitUntil(
    self.registration.showNotification('Food is Ready! ☕', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  // If they tap the notification, open the browser back to the menu
  event.waitUntil(
    clients.openWindow('/')
  );
});