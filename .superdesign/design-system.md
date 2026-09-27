# OZMO Calendar Design System

## Product
OZMO is a bilingual content-operations system. Staff plan client publishing, report content production, add review links, and track client views/publishing. Clients use an Arabic RTL portal. The calendar must be instantly understandable on desktop and mobile.

## Visual direction
Technical-minimalist calendar structure inspired by precise mosaic grids, adapted strictly to OZMO’s existing identity. Use clean 1px grid lines, generous whitespace, flat semantic color blocks, and clear date hierarchy. Do not introduce unrelated fonts, colors, gradients, decorative artwork, or generic dashboard visual noise.

## Brand tokens
- Orange primary: `#ff5a0a`; deep orange: `#d94300`; pale orange: `#fff0e6`.
- Ink: `#172019`; muted: `#758078`; canvas: `#f3f6f3`; surface: `#ffffff`; line: `#e7ebe7`.
- Ready: blue `#3b72d9` / `#eaf1ff`.
- Review pending: amber `#ae7311` / `#fff7dd`.
- Client viewed: purple `#7654c7` / `#f0ebff`.
- Published: green `#149361` / `#e8f7f0`.
- Planned: gray `#758078` / `#f7f9f7`.
- Error: red `#d74545` / `#fff0ef`.

## Typography
- Staff: Inter, system sans-serif.
- Portal: SF Pro/system with Noto Sans Arabic fallback.
- Arabic status labels must remain Arabic: مجدول، جاهز، بانتظار مراجعة العميل، شاهده العميل، تم النشر.
- Date numbers should be bold and tabular. Metadata is 11–12px, body 13–14px, section title 24–34px.

## Real month calendar
- Seven columns on desktop/tablet with weekday header row.
- Month grid always includes leading/trailing blank days so dates align correctly.
- Each day cell has a minimum 112px height desktop, date number in the top corner, and stacked Reel/Post content pills.
- Today gets an orange ring/marker. Days outside the active month are muted.
- Status is communicated by both Arabic text and color; never color alone.
- Published uses green text and green-tinted surface.
- Calendar legend remains visible near month controls.
- Staff calendar includes client tabs, month navigation, admin schedule configuration, and account-manager link actions without crowding the grid.
- Portal calendar is RTL and client-friendly with larger Arabic labels and one obvious “عرض المحتوى” action.

## Responsive behavior
- ≥ 900px: complete seven-column month grid.
- 600–899px: seven-column compact grid with shorter labels and horizontal-safe sizing.
- < 600px: preserve calendar semantics using a horizontally scrollable seven-column grid with sticky weekday headings; day cells remain at least 92px wide. Do not turn it into an unrelated card list.
- Dialogs are centered desktop and bottom-sheet style mobile; controls are at least 44px.

## Notification UX
- Client receives the same simple one-time permission prompt pattern as staff, localized to Arabic.
- Explain value before invoking browser permission. Include Allow and Later actions.
- Admin-to-client notification composer clearly shows recipient client, Arabic title/message, and delivery result.
- In-app portal notification remains available even if browser permission is denied.

## Accessibility
- WCAG AA contrast, keyboard focus rings, semantic buttons, real headings, `aria-label` on icon controls.
- Status includes visible text. Reduced-motion respected.
- Dark mode must retain semantic status contrast.
