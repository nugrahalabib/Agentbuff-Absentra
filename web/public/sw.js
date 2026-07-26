// Self-destructing service worker.
// A previous PWA build may have registered a SW that cached a stale shell
// (causing a blank page). This kill-switch unregisters itself, clears all
// caches, and reloads any controlled tabs so the page loads fresh from the
// dev server. Safe no-op once no SW is registered.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      } catch {}
      await self.registration.unregister()
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const c of clients) c.navigate(c.url)
    })(),
  )
})
