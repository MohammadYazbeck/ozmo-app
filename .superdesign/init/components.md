# Shared UI primitives

The application uses custom React primitives colocated in `app/OzmoApp.tsx` and `app/portal/ClientPortal.tsx`; there is no third-party component library.

## Icon (`app/OzmoApp.tsx`)
```tsx
function Icon({ name, size = 20 }: { name: "home" | "box" | "clients" | "calendar" | "team" | "activity" | "settings" | "history" | "help" | "bell" | "plus" | "check" | "logout" | "arrow" | "spark" | "menu" | "close" | "lock" | "edit" | "eye" | "refresh" | "download" | "send"; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{/* path selected by name */}</svg>;
}
```

## PageHeading (`app/OzmoApp.tsx`)
```tsx
function PageHeading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: ReactNode }) {
  return <header className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div>{action}</header>;
}
```

## Portal primitives (`app/portal/ClientPortal.tsx`)
```tsx
function PageHeading({ title, month }: { title: string; month?: string }) { return <header className={styles.pageHeading}><h1 tabIndex={-1}>{title}</h1>{month && <span className={styles.monthChip}>{monthLabel(month)}</span>}</header>; }
function Empty({ text }: { text: string }) { return <div className={styles.empty}><p>{text}</p></div>; }
```
