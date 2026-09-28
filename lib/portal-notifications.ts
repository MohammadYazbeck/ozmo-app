import { getD1 } from "@/lib/db";
import { sendPushToPortalClient } from "@/lib/push";

export async function notifyPortalClient(
  clientId: number,
  notification: { titleAr: string; messageAr: string; titleEn: string; messageEn: string; url?: string },
) {
  const inserted = await getD1()
    .prepare("INSERT INTO portal_notifications (client_id,calendar_item_id,title_ar,message_ar,title_en,message_en) VALUES (?,NULL,?,?,?,?)")
    .bind(clientId, notification.titleAr, notification.messageAr, notification.titleEn, notification.messageEn)
    .run();
  return sendPushToPortalClient(clientId, {
    id: String(inserted.meta.last_row_id),
    titleAr: notification.titleAr,
    messageAr: notification.messageAr,
    titleEn: notification.titleEn,
    messageEn: notification.messageEn,
    url: notification.url ?? "/portal",
  });
}
