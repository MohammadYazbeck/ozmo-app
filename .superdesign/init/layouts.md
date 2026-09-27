# Shared layouts

## Root layout — `app/layout.tsx`
```tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ff5a0a" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
```

## Staff app shell — `app/OzmoApp.tsx`
`AppShell` renders the fixed dark OZMO sidebar, role-aware navigation, mobile drawer/scrim, user card, top bar, notification panel, and responsive workspace. Its content is supplied through `children` and current section through `section`/`onSection`.

## Client portal shell — `app/portal/ClientPortal.tsx`
`ClientPortal` renders an RTL Arabic portal with centered OZMO brand header, light/dark toggle, logout, desktop tabs, fixed mobile navigation, page workspace, notification prompts, and floating contact buttons.
