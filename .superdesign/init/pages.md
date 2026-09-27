# Page dependency trees

## `/` Staff application
Entry: `app/page.tsx`
- `app/OzmoApp.tsx`
  - `app/browserNotifications.ts`
  - `app/PaymentHistory.tsx`
  - `app/globals.css` via root layout
- API dependencies for calendar: `app/api/calendar/route.ts`, `lib/content-calendar.ts`, `lib/db.ts`

## `/portal` Client portal
Entry: `app/portal/page.tsx`
- `app/portal/ClientPortal.tsx`
  - `app/portal/portal.module.css`
  - `app/PaymentHistory.tsx`
- API dependencies: `app/api/portal/calendar/route.ts`, `app/api/portal/summary/route.ts`, `lib/portal-auth.ts`, `lib/db.ts`

## Calendar feature
- Staff renderer: `ContentCalendarPage` in `app/OzmoApp.tsx`
- Portal renderer: `Calendar` in `app/portal/ClientPortal.tsx`
- Shared status/data: `app/api/calendar/route.ts`, `app/api/portal/calendar/route.ts`, `lib/content-calendar.ts`
