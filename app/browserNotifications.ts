"use client";

export type BrowserNotificationIssue =
  | "ready"
  | "test_failed"
  | "certificate_untrusted"
  | "push_provider_unavailable"
  | "subscription_required"
  | "permission_required"
  | "permission_blocked"
  | "https_required"
  | "ios_install_required"
  | "unsupported";

export type BrowserNotificationStatus = {
  issue: BrowserNotificationIssue;
  permission: NotificationPermission | "unsupported";
  secureContext: boolean;
  serviceWorkerSupported: boolean;
  serviceWorkerRegistered: boolean;
  pushManagerSupported: boolean;
  pushConfigured: boolean;
  pushSubscribed: boolean;
  lastError?: string;
  isIos: boolean;
  isAndroid: boolean;
  isStandalone: boolean;
  browserLabel: string;
};

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

const SERVICE_WORKER_URL = "/sw.js?v=20260728-2";

class BrowserNotificationSetupError extends Error {
  constructor(
    readonly issue: BrowserNotificationIssue,
    message: string,
  ) {
    super(message);
    this.name = "BrowserNotificationSetupError";
  }
}

function isIosDevice() {
  const navigatorWithStandalone = navigator as NavigatorWithStandalone;
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
    navigatorWithStandalone.standalone === true
  );
}

function isStandaloneApp() {
  const navigatorWithStandalone = navigator as NavigatorWithStandalone;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

function isAndroidDevice() {
  return /Android/i.test(navigator.userAgent);
}

function browserLabel() {
  const agent = navigator.userAgent;
  if (/SamsungBrowser/i.test(agent)) return "Samsung Internet";
  if (/Firefox|FxiOS/i.test(agent)) return "Mozilla Firefox";
  if (/EdgA/i.test(agent)) return "Microsoft Edge on Android";
  if (/EdgiOS/i.test(agent)) return "Microsoft Edge on iOS";
  if (/Edg/i.test(agent)) return "Microsoft Edge";
  if (/CriOS/i.test(agent)) return "Google Chrome on iOS";
  if (/Chrome|Chromium|CriOS/i.test(agent)) return "Google Chrome";
  if (/Safari/i.test(agent)) return "Safari";
  return "this browser";
}

function readBaseStatus(): BrowserNotificationStatus {
  const isIos = isIosDevice();
  const isAndroid = isAndroidDevice();
  const isStandalone = isStandaloneApp();
  const serviceWorkerSupported = "serviceWorker" in navigator;
  const pushManagerSupported = "PushManager" in window;
  const permission =
    "Notification" in window ? Notification.permission : "unsupported";

  let issue: BrowserNotificationIssue;
  if (!window.isSecureContext) {
    issue = "https_required";
  } else if (isIos && !isStandalone) {
    issue = "ios_install_required";
  } else if (
    permission === "unsupported" ||
    !serviceWorkerSupported ||
    !pushManagerSupported
  ) {
    issue = "unsupported";
  } else if (permission === "denied") {
    issue = "permission_blocked";
  } else if (permission === "default") {
    issue = "permission_required";
  } else {
    issue = "subscription_required";
  }

  return {
    issue,
    permission,
    secureContext: window.isSecureContext,
    serviceWorkerSupported,
    serviceWorkerRegistered: false,
    pushManagerSupported,
    pushConfigured: false,
    pushSubscribed: false,
    isIos,
    isAndroid,
    isStandalone,
    browserLabel: browserLabel(),
  };
}

export async function getBrowserNotificationStatus(): Promise<BrowserNotificationStatus> {
  const status = readBaseStatus();
  let registration: ServiceWorkerRegistration | undefined;
  if (status.secureContext && status.serviceWorkerSupported) {
    registration =
      (await navigator.serviceWorker.getRegistration("/").catch(() => undefined)) ??
      undefined;
  }
  const registeredStatus = {
    ...status,
    serviceWorkerRegistered: Boolean(registration),
  };
  if (
    status.permission !== "granted" ||
    !status.secureContext ||
    !status.serviceWorkerSupported ||
    !status.pushManagerSupported
  ) {
    return registeredStatus;
  }

  try {
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return registeredStatus;
    const response = await fetch(
      `/api/push?endpoint=${encodeURIComponent(subscription.endpoint)}`,
      {
      credentials: "same-origin",
      cache: "no-store",
      },
    );
    const server = (await response.json()) as {
      configured?: boolean;
      subscribed?: boolean;
    };
    const pushConfigured = response.ok && server.configured === true;
    const pushSubscribed =
      pushConfigured && server.subscribed === true;
    return {
      ...registeredStatus,
      issue: pushSubscribed ? "ready" : "subscription_required",
      pushConfigured,
      pushSubscribed,
    };
  } catch {
    return registeredStatus;
  }
}

export async function getOzmoServiceWorker() {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) {
    throw new Error("A trusted HTTPS connection is required.");
  }

  const registration = await navigator.serviceWorker.register(
    SERVICE_WORKER_URL,
    { scope: "/", updateViaCache: "none" },
  );
  await registration.update();
  return navigator.serviceWorker.ready;
}

export async function showBrowserNotification(payload: {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}) {
  if (
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return false;
  }

  const registration = await getOzmoServiceWorker();
  await registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag,
    data: { url: payload.url || "/" },
  });
  return true;
}

export async function enableBrowserNotifications(): Promise<BrowserNotificationStatus> {
  const before = readBaseStatus();
  if (
    before.issue !== "permission_required" &&
    before.issue !== "subscription_required" &&
    before.issue !== "test_failed" &&
    before.issue !== "certificate_untrusted" &&
    before.issue !== "push_provider_unavailable" &&
    before.issue !== "ready"
  ) {
    return before;
  }

  try {
    const permission =
      before.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();

    if (permission === "granted") {
      let subscription = await ensureBrowserPushSubscription();

      try {
        let test = await testBrowserPushSubscription(subscription);
        if (!test.delivered && test.expired) {
          await subscription.unsubscribe();
          subscription = await ensureBrowserPushSubscription();
          test = await testBrowserPushSubscription(subscription);
        }
        if (!test.ok || !test.delivered) {
          throw new Error(
            test.error ||
              test.warning ||
              "The test alert could not be delivered.",
          );
        }
      } catch (testError) {
        return {
          ...(await getBrowserNotificationStatus()),
          issue: "test_failed" as const,
          lastError: `This device is subscribed, but the test alert failed: ${
            (testError as Error).message
          }`,
        };
      }
    }
  } catch (error) {
    const status = await getBrowserNotificationStatus();
    return {
      ...status,
      issue: notificationIssueForError(error, status.issue),
      lastError: notificationMessageForError(error),
    };
  }

  return getBrowserNotificationStatus();
}

/**
 * Repairs the background push connection after permission has already been
 * granted. This is safe to call on login and when the app becomes visible; it
 * never opens a permission prompt and does not send a test notification.
 */
export async function reconcileBrowserPushSubscription(): Promise<BrowserNotificationStatus> {
  const status = readBaseStatus();
  if (
    status.permission !== "granted" ||
    !status.secureContext ||
    !status.serviceWorkerSupported ||
    !status.pushManagerSupported
  ) {
    return getBrowserNotificationStatus();
  }
  try {
    await ensureBrowserPushSubscription();
    return getBrowserNotificationStatus();
  } catch (error) {
    const current = await getBrowserNotificationStatus();
    return {
      ...current,
      issue: notificationIssueForError(error, current.issue),
      lastError: notificationMessageForError(error),
    };
  }
}

async function ensureBrowserPushSubscription() {
  const registration = await getOzmoServiceWorker();
  if (!("pushManager" in registration)) {
    throw new Error("This browser does not provide Web Push.");
  }

  const configurationResponse = await fetch("/api/push", {
    credentials: "same-origin",
    cache: "no-store",
  });
  const configuration = (await configurationResponse.json()) as {
    configured?: boolean;
    publicKey?: string;
  };
  if (
    !configurationResponse.ok ||
    !configuration.configured ||
    !configuration.publicKey
  ) {
    throw new Error("The OZMO push service is not configured yet.");
  }

  const applicationServerKey = decodeVapidPublicKey(configuration.publicKey);
  let existingSubscription = await registration.pushManager.getSubscription();
  if (
    existingSubscription &&
    !sameApplicationServerKey(
      existingSubscription.options.applicationServerKey,
      applicationServerKey,
    )
  ) {
    await removeBrowserPushSubscription(existingSubscription.endpoint).catch(
      () => undefined,
    );
    await existingSubscription.unsubscribe();
    existingSubscription = null;
  }
  const subscription =
    existingSubscription ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    }));
  await saveBrowserPushSubscription(subscription);
  return subscription;
}

async function saveBrowserPushSubscription(subscription: PushSubscription) {
  const response = await fetch("/api/push", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      deviceLabel: `${browserLabel()} · ${navigator.platform || "device"}`,
      platform: navigator.userAgent,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
    };
    if (
      body.code === "PUSH_ENDPOINT_UNSUPPORTED" ||
      body.code === "PUSH_SUBSCRIPTION_INVALID"
    ) {
      const provider = safeEndpointHostname(subscription.endpoint);
      throw new BrowserNotificationSetupError(
        "push_provider_unavailable",
        `This browser returned an unusable background push connection${
          provider ? ` (${provider})` : ""
        }. Update the browser and confirm Google Play Services or the device push service is available.`,
      );
    }
    throw new Error(body.error || "OZMO could not save this device.");
  }
}

async function removeBrowserPushSubscription(endpoint: string) {
  const response = await fetch("/api/push", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) {
    throw new Error("The old browser connection could not be removed.");
  }
}

async function testBrowserPushSubscription(subscription: PushSubscription) {
  const response = await fetch("/api/push/test", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    delivered?: number;
    expired?: number;
    warning?: string | null;
  };
  return {
    ...body,
    ok: response.ok,
  };
}

function decodeVapidPublicKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const decoded = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function sameApplicationServerKey(
  current: ArrayBuffer | null,
  expected: Uint8Array<ArrayBuffer>,
) {
  if (!current) return false;
  const currentBytes = new Uint8Array(current);
  if (currentBytes.length !== expected.length) return false;
  return currentBytes.every((value, index) => value === expected[index]);
}

function notificationIssueForError(
  error: unknown,
  fallback: BrowserNotificationIssue,
): BrowserNotificationIssue {
  if (error instanceof BrowserNotificationSetupError) return error.issue;
  const message = error instanceof Error ? error.message : String(error);
  if (
    /ssl certificate|certificate error|certificate.*trust|failed to register a serviceworker/i.test(
      message,
    )
  ) {
    return "certificate_untrusted";
  }
  if (/public https service|push service|push connection/i.test(message)) {
    return "push_provider_unavailable";
  }
  return fallback;
}

function notificationMessageForError(error: unknown) {
  if (error instanceof BrowserNotificationSetupError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (
    /ssl certificate|certificate error|certificate.*trust|failed to register a serviceworker/i.test(
      message,
    )
  ) {
    return `The OZMO certificate is not trusted by ${browserLabel()}. Open ${deviceSetupUrl()}, reinstall the current OZMO certificate in the device’s trusted CA/root store, fully close the browser, then reopen OZMO.`;
  }
  return message;
}

function safeEndpointHostname(endpoint: string) {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return "";
  }
}

export function deviceSetupUrl() {
  const fallbackHost = "192.168.1.196";
  const currentHost =
    typeof window === "undefined" ? fallbackHost : window.location.hostname;
  const usableHost =
    currentHost === "localhost" ||
    currentHost === "127.0.0.1" ||
    currentHost === "::1"
      ? fallbackHost
      : currentHost;
  const formattedHost = usableHost.includes(":")
    ? `[${usableHost}]`
    : usableHost;
  return `http://${formattedHost}:3001`;
}
