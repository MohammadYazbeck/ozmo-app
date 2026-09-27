# Theme summary

- Brand: OZMO orange `#ff5a0a`, deep orange `#d94300`.
- Staff: canvas `#f3f6f3`, surface white, ink `#172019`, muted `#758078`, line `#e7ebe7`.
- Status: green `#149361`, blue `#3b72d9`, amber `#ae7311`, red `#d74545`, each with pale surface token.
- Portal: ink `#19231f`, canvas `#f5f7f3`, card white, muted `#738078`, green `#148d5d`, blue `#4776d8`.
- Typography: Inter/system for staff; SF Pro/system plus Noto Sans Arabic for portal.
- Radius: 10, 16, 22, 30px. Cards commonly 17–24px; pills 999px.
- Shadows: subtle 1–18px staff, elevated 18–90px overlays.
- Responsive breakpoints: 980px, 760px, 430px, 390px.
- Motion: 150–300ms, small translate/scale; reduced-motion override.

## Raw source locations

The authoritative complete styles are `app/globals.css` (staff, 5,000+ lines) and `app/portal/portal.module.css` (portal). Relevant calendar design calls must use ranged context from those files because each exceeds the 900-line trimming threshold or is route-specific.
