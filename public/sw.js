const DEFAULT_URL = "/";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function preferredText(payload) {
  const isArabic = (self.navigator?.language || "").toLowerCase().startsWith("ar");
  return {
    title: isArabic
      ? payload.titleAr || payload.titleEn || "OZMO"
      : payload.titleEn || payload.titleAr || "OZMO",
    body: isArabic
      ? payload.messageAr || payload.messageEn || ""
      : payload.messageEn || payload.messageAr || "",
  };
}

async function showOzmoNotification(payload = {}) {
  const text = preferredText(payload);
  return self.registration.showNotification(text.title, {
    body: text.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.dedupeKey || payload.id || `ozmo-${Date.now()}`,
    renotify: true,
    requireInteraction: true,
    silent: false,
    timestamp: Date.now(),
    vibrate: [240, 90, 240],
    data: {
      url: payload.url || DEFAULT_URL,
      notificationId: payload.id || null,
    },
  });
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      titleEn: "OZMO notification",
      titleAr: "إشعار OZMO",
      messageEn: event.data ? event.data.text() : "",
      messageAr: event.data ? event.data.text() : "",
    };
  }
  event.waitUntil(showOzmoNotification(payload));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "SHOW_OZMO_NOTIFICATION") return;
  event.waitUntil(showOzmoNotification(event.data.payload || {}));
});

self.addEventListener("pushsubscriptionchange", (event) => {
  if (!event.newSubscription) return;
  event.waitUntil(
    fetch("/api/push", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: event.newSubscription.toJSON(),
        deviceLabel: `Automatic repair · ${self.navigator?.userAgent || "device"}`,
        platform: self.navigator?.userAgent || "",
      }),
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(
    event.notification.data?.url || DEFAULT_URL,
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(
      (windows) => {
        for (const windowClient of windows) {
          if (windowClient.url === targetUrl && "focus" in windowClient) {
            return windowClient.focus();
          }
        }
        return self.clients.openWindow
          ? self.clients.openWindow(targetUrl)
          : undefined;
      },
    ),
  );
});
