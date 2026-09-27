# Extractable components

## AppShell
- Source: `app/OzmoApp.tsx`
- Category: layout
- Description: OZMO staff sidebar, top bar and responsive workspace.
- Props: active section, user role, notification count.
- Hardcoded: brand, nav labels, icons and shell styling.

## PortalNavigation
- Source: `app/portal/ClientPortal.tsx`
- Category: layout
- Description: RTL desktop and mobile client navigation.
- Props: active view.
- Hardcoded: Arabic labels, icons and responsive layout.

## CalendarMonthGrid
- Source: calendar renderers in staff and portal files.
- Category: basic
- Description: responsive seven-column month grid with status-coded content cards.
- Props: month, items, selected client, role, review link actions.
- Hardcoded: Arabic weekday/status labels and OZMO color tokens.

## StatusBadge
- Source: `app/OzmoApp.tsx`, `app/portal/ClientPortal.tsx`
- Category: basic
- Description: compact semantic status chip.
- Props: status.
- Hardcoded: Arabic status labels and semantic colors.
