// LendHous's service worker. It does one thing: shows the notifications LendHous sends to this browser (lib/push.ts), and
// opens the page each one is about when it's tapped. Nothing is cached, so the portal is always the live one.
self.addEventListener("push", (event) => {
  let message = { title: "LendHous", body: "You have a new notification.", url: "/admin/account/notifications" };
  try {
    if (event.data) message = { ...message, ...event.data.json() };
  } catch {
    // A message that isn't JSON still shows, with the words above.
  }
  event.waitUntil(self.registration.showNotification(message.title, { body: message.body, icon: "/icon.png", badge: "/icon.png", tag: message.tag, data: { url: message.url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only a page of this site opens, whatever the message says.
  const target = new URL(event.notification.data?.url || "/admin", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : `${self.location.origin}/admin`;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const open = windows.find((item) => item.url.startsWith(self.location.origin));
    if (open) return open.navigate(url).then((page) => (page ?? open).focus());
    return self.clients.openWindow(url);
  }));
});
