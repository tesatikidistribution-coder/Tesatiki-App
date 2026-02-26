// Service Worker for Tesatiki PWA

const CACHE_NAME = 'tesatiki-v1';
const OFFLINE_URL = '/offline.html';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/login.html',
  '/register.html',
  '/sell.html',
  '/profile.html',
  '/saved.html',
  '/offline.html',

  '/style.css',
  '/login.css',
  '/register.css',
  '/sell.css',
  '/profile.css',
  '/api.js',
  '/config.js',
  '/script.js',
  '/login.js',
  '/register.js',
  '/sell.js',
  '/profile.js',

  '/manifest.json',
  '/tesatiki-icon-192.png',
  '/tesatiki-icon-512.png',
  '/tesatiki-logo.png',

  'https://unpkg.com/boxicons@2.1.4/css/boxicons.min.css'
];

// Install event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event
self.addEventListener('fetch', event => {
  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Handle API requests
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          // Return cached API response if available
          return caches.match(event.request);
        })
    );
    return;
  }

  // For navigation requests, try network first, then cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // For other requests, try cache first, then network
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        return fetch(event.request)
          .then(response => {
            // Don't cache if not a success response
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone the response
            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch(() => {
            // If offline and request is for an image, return placeholder
            if (event.request.destination === 'image') {
              return caches.match('/images/placeholder.png');
            }
          });
      })
  );
});

// Background sync for offline actions
self.addEventListener('sync', event => {
  if (event.tag === 'sync-queue') {
    event.waitUntil(syncOfflineActions());
  }
});

async function syncOfflineActions() {
  const queue = await getSyncQueue();
  
  for (const action of queue) {
    try {
      await processSyncAction(action);
      await removeFromSyncQueue(action.id);
    } catch (error) {
      console.error('Failed to sync action:', error);
    }
  }
}

async function getSyncQueue() {
  const cache = await caches.open('sync-queue');
  const keys = await cache.keys();
  const actions = [];
  
  for (const key of keys) {
    const response = await cache.match(key);
    if (response) {
      const action = await response.json();
      actions.push(action);
    }
  }
  
  return actions;
}

async function processSyncAction(action) {
  // Process different types of actions
  switch (action.type) {
    case 'save_product':
      // await sendToServer('/api/products', action.data);
      break;
    case 'save_item':
      // await sendToServer('/api/saved', action.data);
      break;
    case 'send_message':
      // await sendToServer('/api/messages', action.data);
      break;
  }
}

async function sendToServer(url, data) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  
  return response.json();
}

async function removeFromSyncQueue(id) {
  const cache = await caches.open('sync-queue');
  await cache.delete(`/sync-action-${id}`);
}

// Push notifications
self.addEventListener('push', event => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/tesatiki-icon-192.png',
    badge: '/tesatiki-icon-72.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/'
    },
    actions: [
      {
        action: 'view',
        title: 'View'
      },
      {
        action: 'dismiss',
        title: 'Dismiss'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Tesatiki', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow(event.notification.data.url)
    );
  }
});

// Periodic background sync (for Chrome)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'update-content') {
    event.waitUntil(updateContent());
  }
});

async function updateContent() {
  const cache = await caches.open(CACHE_NAME);
  
  // Update cached content
  const responses = await Promise.all(
    ASSETS_TO_CACHE.map(url => fetch(url))
  );
  
  const cachePromises = responses.map((response, i) => {
    if (response.ok) {
      return cache.put(ASSETS_TO_CACHE[i], response);
    }
  });
  
  await Promise.all(cachePromises);
}

// Handle messages from the main thread
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then(cache => cache.addAll(event.data.urls))
    );
  }
});