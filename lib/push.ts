import webpush, {
  type PushSubscription as WebPushSubscription,
  WebPushError,
} from "web-push";

import { ensureDatabase, getD1 } from "@/lib/db";
import { isPublicPushHostname } from "@/lib/pushEndpoint";

const VAPID_SETTING_KEY = "browser_push_vapid_keys";
// Apple rejects VAPID identity tokens whose contact subject uses a private
// `.local` host or mail domain. Use a globally valid reserved contact URI
// until OZMO supplies a monitored public company email address.
const VAPID_SUBJECT = "mailto:admin@example.com";
const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_KEY_LENGTH = 512;

export type StoredPushSubscription = {
  id: number;
  userId: number;
  endpoint: string;
  expirationTime: number | null;
  p256dh: string;
  auth: string;
  deviceLabel: string;
  platform: string;
  isActive: number;
};

export type BrowserPushPayload = {
  id?: string | number;
  titleEn: string;
  titleAr: string;
  messageEn: string;
  messageAr: string;
  dedupeKey?: string;
  url?: string;
};

type StoredVapidKeys = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export type PushDeliveryResult = {
  attempted: number;
  delivered: number;
  expired: number;
  failed: number;
  lastError?: string;
};

let pushTableReady = false;

export async function ensurePushSupport() {
  await ensureDatabase();
  if (pushTableReady) return;

  const database = getD1();
  await database
    .prepare(
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        expiration_time INTEGER,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        device_label TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        failure_count INTEGER NOT NULL DEFAULT 0,
        last_success_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
    )
    .run();
  await database
    .prepare(
      `CREATE INDEX IF NOT EXISTS push_subscriptions_user_active_idx
       ON push_subscriptions(user_id,is_active)`,
    )
    .run();
  pushTableReady = true;
}

export async function getBrowserPushConfiguration(
  userId: number,
  targetEndpoint?: string,
) {
  await ensurePushSupport();
  const keys = await getOrCreateVapidKeys();
  const endpoint =
    typeof targetEndpoint === "string" &&
    targetEndpoint.length >= 12 &&
    targetEndpoint.length <= MAX_ENDPOINT_LENGTH
      ? targetEndpoint
      : null;
  const count = await getD1()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM push_subscriptions
       WHERE user_id = ? AND is_active = 1
         AND (? IS NULL OR endpoint = ?)`,
    )
    .bind(userId, endpoint, endpoint)
    .first<{ count: number }>();

  const subscriptionCount = Number(count?.count ?? 0);
  return {
    configured: true,
    publicKey: keys.publicKey,
    subscribed: subscriptionCount > 0,
    subscriptionCount,
  };
}

export async function savePushSubscription(
  userId: number,
  subscription: WebPushSubscription,
  details: { deviceLabel?: string; platform?: string } = {},
) {
  await ensurePushSupport();
  validateSubscription(subscription);
  const now = new Date().toISOString();

  await getD1()
    .prepare(
      `INSERT INTO push_subscriptions (
        user_id,endpoint,expiration_time,p256dh,auth,
        device_label,platform,is_active,failure_count,
        created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,1,0,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id,
        expiration_time = excluded.expiration_time,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        device_label = excluded.device_label,
        platform = excluded.platform,
        is_active = 1,
        failure_count = 0,
        updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      subscription.endpoint,
      subscription.expirationTime ?? null,
      subscription.keys.p256dh,
      subscription.keys.auth,
      truncate(details.deviceLabel, 120),
      truncate(details.platform, 80),
      now,
      now,
    )
    .run();
}

export async function removePushSubscription(
  userId: number,
  endpoint: string,
) {
  await ensurePushSupport();
  const result = await getD1()
    .prepare(
      `DELETE FROM push_subscriptions
       WHERE user_id = ? AND endpoint = ?`,
    )
    .bind(userId, endpoint)
    .run();
  return Number(result.meta?.changes ?? 0);
}

export async function sendPushToUser(
  userId: number,
  payload: BrowserPushPayload,
  targetEndpoint?: string,
): Promise<PushDeliveryResult> {
  await ensurePushSupport();
  const keys = await getOrCreateVapidKeys();
  const subscriptions = await getD1()
    .prepare(
      `SELECT
        id,
        user_id AS userId,
        endpoint,
        expiration_time AS expirationTime,
        p256dh,
        auth,
        device_label AS deviceLabel,
        platform,
        is_active AS isActive
       FROM push_subscriptions
       WHERE user_id = ? AND is_active = 1
       ORDER BY id`,
    )
    .bind(userId)
    .all<StoredPushSubscription>();

  const targets = targetEndpoint
    ? subscriptions.results.filter(
        (subscription) => subscription.endpoint === targetEndpoint,
      )
    : subscriptions.results;
  const result: PushDeliveryResult = {
    attempted: targets.length,
    delivered: 0,
    expired: 0,
    failed: 0,
  };

  await Promise.all(
    targets.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          toWebPushSubscription(subscription),
          JSON.stringify(payload),
          {
            vapidDetails: keys,
            TTL: 60 * 60 * 24,
            urgency: "high",
          },
        );
        result.delivered += 1;
        await getD1()
          .prepare(
            `UPDATE push_subscriptions
             SET failure_count = 0,
                 last_success_at = ?,
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(
            new Date().toISOString(),
            new Date().toISOString(),
            subscription.id,
          )
          .run();
      } catch (error) {
        const statusCode =
          error instanceof WebPushError ? error.statusCode : undefined;
        const providerReason = safeProviderFailureReason(error);
        if (statusCode === 404 || statusCode === 410) {
          result.expired += 1;
          result.lastError ??= providerReason;
          await getD1()
            .prepare(
              `UPDATE push_subscriptions
               SET is_active = 0,
                   failure_count = failure_count + 1,
                   updated_at = ?
               WHERE id = ?`,
            )
            .bind(new Date().toISOString(), subscription.id)
            .run();
          return;
        }

        result.failed += 1;
        result.lastError ??= providerReason;
        await getD1()
          .prepare(
            `UPDATE push_subscriptions
             SET failure_count = failure_count + 1,
                 updated_at = ?
             WHERE id = ?`,
          )
          .bind(new Date().toISOString(), subscription.id)
          .run();
        console.error("OZMO browser push delivery failed", {
          subscriptionId: subscription.id,
          statusCode,
          providerReason,
        });
      }
    }),
  );

  return result;
}

async function getOrCreateVapidKeys(): Promise<StoredVapidKeys> {
  await ensureDatabase();
  const database = getD1();
  const existing = await database
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(VAPID_SETTING_KEY)
    .first<{ value: string }>();
  const parsed = parseVapidKeys(existing?.value);
  if (parsed) {
    if (parsed.subject === VAPID_SUBJECT) return parsed;

    // Keep the existing public/private key pair so every saved device
    // subscription remains valid; only repair the provider contact subject.
    const migrated: StoredVapidKeys = {
      ...parsed,
      subject: VAPID_SUBJECT,
    };
    await database
      .prepare(
        `UPDATE settings
         SET value = ?, updated_at = ?
         WHERE key = ?`,
      )
      .bind(
        JSON.stringify(migrated),
        new Date().toISOString(),
        VAPID_SETTING_KEY,
      )
      .run();
    return migrated;
  }

  const generated = webpush.generateVAPIDKeys();
  const candidate: StoredVapidKeys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: VAPID_SUBJECT,
  };

  await database
    .prepare(
      `INSERT OR IGNORE INTO settings (key,value,updated_at)
       VALUES (?,?,?)`,
    )
    .bind(
      VAPID_SETTING_KEY,
      JSON.stringify(candidate),
      new Date().toISOString(),
    )
    .run();

  const stored = await database
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(VAPID_SETTING_KEY)
    .first<{ value: string }>();
  return parseVapidKeys(stored?.value) ?? candidate;
}

function validateSubscription(subscription: WebPushSubscription) {
  if (
    !subscription ||
    typeof subscription.endpoint !== "string" ||
    subscription.endpoint.length < 12 ||
    subscription.endpoint.length > MAX_ENDPOINT_LENGTH
  ) {
    throw new Error("Invalid browser push endpoint.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(subscription.endpoint);
  } catch {
    throw new Error("Invalid browser push endpoint.");
  }
  if (endpoint.protocol !== "https:" || !isPublicPushHostname(endpoint.hostname)) {
    throw new Error("Browser push endpoint must use a public HTTPS service.");
  }

  if (
    !subscription.keys ||
    typeof subscription.keys.p256dh !== "string" ||
    typeof subscription.keys.auth !== "string" ||
    subscription.keys.p256dh.length < 16 ||
    subscription.keys.auth.length < 8 ||
    subscription.keys.p256dh.length > MAX_KEY_LENGTH ||
    subscription.keys.auth.length > MAX_KEY_LENGTH
  ) {
    throw new Error("Invalid browser push encryption keys.");
  }
}

function parseVapidKeys(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredVapidKeys>;
    if (
      typeof parsed.publicKey === "string" &&
      typeof parsed.privateKey === "string" &&
      typeof parsed.subject === "string"
    ) {
      return parsed as StoredVapidKeys;
    }
  } catch {
    // A malformed value is replaced by a new valid key pair.
  }
  return null;
}

function toWebPushSubscription(
  subscription: StoredPushSubscription,
): WebPushSubscription {
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };
}

function truncate(value: string | undefined, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeProviderFailureReason(error: unknown) {
  if (error instanceof WebPushError) {
    const body = typeof error.body === "string" ? error.body : "";
    try {
      const parsed = JSON.parse(body) as { reason?: unknown };
      if (
        typeof parsed.reason === "string" &&
        /^[A-Za-z0-9_.:-]{1,80}$/.test(parsed.reason)
      ) {
        return parsed.reason;
      }
    } catch {
      // Provider bodies are not always JSON. Do not expose raw response data.
    }
    return error.statusCode
      ? `Push provider HTTP ${error.statusCode}`
      : "Push provider rejected the notification";
  }
  return error instanceof Error
    ? error.message.slice(0, 160)
    : "Unknown push delivery error";
}
