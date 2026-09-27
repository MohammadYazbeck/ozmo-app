# Routes

- `/` — `app/page.tsx` → `app/OzmoApp.tsx`; staff/admin SPA with role-aware sections.
- `/portal` — `app/portal/page.tsx` → `app/portal/ClientPortal.tsx`; authenticated Arabic client portal.
- `/api/calendar` — staff calendar configuration, items and review links.
- `/api/portal/calendar` — client-scoped calendar, review viewing and portal notifications.
- `/api/clients`, `/api/reports`, `/api/history`, `/api/notifications` — core staff data.
- `/api/portal/summary`, `/api/portal/archive`, `/api/portal/auth/*` — client portal data/auth.

Next.js App Router is used. There is no external router configuration.
