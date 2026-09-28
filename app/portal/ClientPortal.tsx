"use client";
/* eslint-disable react-hooks/set-state-in-effect -- this effect hydrates the authenticated server-backed portal */

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import styles from "./portal.module.css";
import PaymentHistory, { type Payment } from "../PaymentHistory";

type View = "overview" | "calendar" | "content" | "sessions" | "services" | "archive" | "billing";
type Language = "ar" | "en";

type PortalCalendar = { enabled: boolean; month: string; items: Array<{ id: string; date: string; contentType: "reel" | "post"; status: "planned" | "ready" | "link_added" | "viewed" | "published"; hasReviewLink: boolean; viewedAt?: string | null }>; notifications: Array<{ id: string; itemId: string | null; titleAr: string; messageAr: string; titleEn: string; messageEn: string; read: boolean; createdAt: string }> };

type PortalUser = {
  id: number;
  email: string;
  displayName: string;
  clientId: number;
  ozmoClientId: string;
  clientName: string;
};

type PortalSummary = {
  payments: Payment[];
  contact: { whatsappNumber: string; phoneNumber: string };
  client: {
    id: string;
    ozmoClientId: string;
    name: string;
    logoUrl?: string | null;
    remainingPaymentCents: number;
    remainingPaymentCurrency: string;
    googleDriveUrl?: string | null;
  };
  month: string;
  content: {
    produced: number;
    published: number;
    inventory: {
      drafts: number;
      shotReels: number;
      readyReels: number;
      readyPosts: number;
      readyStories: number;
    };
    updatedAt: string;
  };
  upcomingSession: {
    id: string;
    scheduledAt: string;
    status: string;
  } | null;
  monthlyKpis: Array<{
    id: string;
    goal: string;
    completed: boolean;
    completedAt: string | null;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    contentType: string | null;
    quantity: number;
    status: string;
    occurredOn: string;
  }>;
};

type PortalArchive = {
  id: string;
  month: string;
  startDate: string;
  endDate: string;
  closedAt: string;
  notes: string;
  taskCount: number;
  content: { produced: number; published: number };
  inventory: { drafts: number; shotReels: number; readyReels: number; readyPosts: number };
  carry: { drafts: number; shotReels: number; readyReels: number; readyPosts: number };
};

const navigation: Array<{ id: View; ar: string; en: string }> = [
  { id: "overview", ar: "نظرة عامة", en: "Overview" },
  { id: "calendar", ar: "التقويم", en: "Calendar" },
  { id: "billing", ar: "الدفعات", en: "Billing" },
  { id: "services", ar: "خدماتنا", en: "Services" },
  { id: "archive", ar: "الأرشيف", en: "Archive" },
];

export default function ClientPortal() {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [summary, setSummary] = useState<PortalSummary | null>(null);
  const [archives, setArchives] = useState<PortalArchive[]>([]);
  const [calendar, setCalendar] = useState<PortalCalendar | null>(null);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [language, setLanguage] = useState<Language>("ar");
  const [month, setMonth] = useState(currentMonth());
  const [notificationPrompt, setNotificationPrompt] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const previousView = useRef(view);

  const loadPortal = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const meResponse = await fetch("/api/portal/auth/me", { cache: "no-store" });
      if (!meResponse.ok) {
        setUser(null);
        setSummary(null);
        setArchives([]);
        return;
      }
      const me = (await meResponse.json()) as { user: PortalUser };
      setUser(me.user);
      const [summaryResponse, archiveResponse, calendarResponse] = await Promise.all([
        fetch(`/api/portal/summary?month=${month}`, { cache: "no-store" }),
        fetch("/api/portal/archive", { cache: "no-store" }),
        fetch(`/api/portal/calendar?month=${month}`, { cache: "no-store" }),
      ]);
      if (!summaryResponse.ok) throw new Error("تعذر تحميل بيانات المحتوى حالياً");
      setSummary((await summaryResponse.json()) as PortalSummary);
      if (archiveResponse.ok) {
        setArchives(((await archiveResponse.json()) as { archives: PortalArchive[] }).archives);
      } else {
        setArchives([]);
      }
      setCalendar(calendarResponse.ok ? await calendarResponse.json() as PortalCalendar : null);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void loadPortal();
  }, [loadPortal]);

  useEffect(() => {
    if (!user) return;
    const refresh = () => { if (document.visibilityState === "visible") void loadPortal(); };
    const interval = window.setInterval(refresh, 20_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, [user, loadPortal]);

  useEffect(() => {
    if (!user || !("Notification" in window) || !("serviceWorker" in navigator) || Notification.permission === "denied") return;
    const key = `ozmo-portal-notification-prompt:${user.id}`;
    if (Notification.permission === "default" && !window.localStorage.getItem(key)) setNotificationPrompt(true);
  }, [user]);

  useEffect(() => {
    const saved = window.localStorage.getItem("ozmo-portal-theme");
    if (saved === "dark" || saved === "light") setTheme(saved);
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches) setTheme("dark");
  }, []);

  useEffect(() => {
    window.localStorage.setItem("ozmo-portal-theme", theme);
  }, [theme]);

  useEffect(() => {
    const saved = window.localStorage.getItem("ozmo-portal-language");
    if (saved === "ar" || saved === "en") setLanguage(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("ozmo-portal-language", language);
    document.cookie = `ozmo_portal_language=${language}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [language]);

  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    workspaceRef.current?.querySelector("h1")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view]);

  if (loading && !user) return <PortalLoading language={language} />;
  if (!user) return <PortalLogin onLogin={loadPortal} language={language} onLanguage={setLanguage} />;

  async function logout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    setUser(null);
    setSummary(null);
    setArchives([]);
    setCalendar(null);
  }

  return (
    <div className={`${styles.portal} ${theme === "dark" ? styles.dark : ""}`} dir={language === "ar" ? "rtl" : "ltr"} lang={language}>
      <header className={styles.shellHeader}>
        <OzmoBrand />
        <div className={styles.headerActions}>
          <button className={styles.headerControl} onClick={() => void loadPortal()} type="button" aria-label={tx(language, "تحديث البيانات", "Refresh data")} disabled={loading}><PortalIcon name="refresh" /><span>{tx(language, "تحديث", "Refresh")}</span></button>
          <button className={styles.headerControl} onClick={() => setLanguage((current) => current === "ar" ? "en" : "ar")} type="button" aria-label={tx(language, "التبديل إلى الإنجليزية", "Switch to Arabic")}>{language === "ar" ? "EN" : "ع"}</button>
          <button className={styles.themeToggle} onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")} type="button" aria-label="Toggle light and dark mode">{theme === "dark" ? "☼" : "☾"}</button>
          <button className={styles.logout} onClick={() => void logout()} type="button" aria-label={tx(language, "تسجيل الخروج", "Log out")}><PortalIcon name="logout" /><span>{tx(language, "خروج", "Logout")}</span></button>
        </div>
      </header>
      <PortalNavigation view={view} onNavigate={setView} language={language} />
      {calendar?.notifications.find((item) => !item.read) && (() => { const notice = calendar.notifications.find((item) => !item.read)!; return <button className={styles.portalCalendarAlert} type="button" onClick={() => { setView("calendar"); if (!notice.itemId) void fetch("/api/portal/calendar", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notificationId: notice.id }) }).then(() => loadPortal()); window.setTimeout(() => notice.itemId && document.getElementById(`calendar-${notice.itemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120); }}><strong>{language === "ar" ? notice.titleAr : notice.titleEn}</strong><span>{language === "ar" ? notice.messageAr : notice.messageEn}</span></button>; })()}

      <main className={styles.workspace} ref={workspaceRef} key={view} id="portal-content" aria-busy={loading}>
        {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={() => void loadPortal()}>{tx(language, "إعادة المحاولة", "Try again")}</button></div>}
        {!summary ? (
          <PortalLoading compact language={language} />
        ) : view === "overview" ? (
          <Overview summary={summary} language={language} />
        ) : view === "calendar" ? (
          <Calendar calendar={calendar} month={month} onMonth={setMonth} onChanged={loadPortal} language={language} />
        ) : view === "content" ? (
          <Content summary={summary} language={language} />
        ) : view === "sessions" ? (
          <Sessions summary={summary} language={language} />
        ) : view === "services" ? (
          <Services language={language} />
        ) : view === "archive" ? (
          <Archive archives={archives} language={language} />
        ) : (
          <Billing summary={summary} language={language} />
        )}
      </main>
      {notificationPrompt && user && <aside className={styles.portalNotificationPrompt} role="dialog" aria-label={tx(language, "السماح بالإشعارات", "Allow notifications")}><div className={styles.portalNotificationIcon}><PortalIcon name="calendar" /></div><div><strong>{tx(language, "تنبيهات مراجعة المحتوى", "Content review alerts")}</strong><p>{tx(language, "اسمح بالإشعارات لنعلمك فور جاهزية محتوى جديد للمراجعة.", "Allow notifications so we can tell you when new content is ready to review.")}</p><div><button type="button" disabled={notificationBusy} onClick={() => void enablePortalNotifications(setNotificationBusy, () => setNotificationPrompt(false))}>{notificationBusy ? tx(language, "جارٍ التفعيل…", "Enabling…") : tx(language, "السماح بالإشعارات", "Allow notifications")}</button><button type="button" onClick={() => { window.localStorage.setItem(`ozmo-portal-notification-prompt:${user.id}`, "later"); setNotificationPrompt(false); }}>{tx(language, "لاحقاً", "Later")}</button></div></div></aside>}
      {summary && <div className={styles.contactButtons} aria-label={tx(language, "تواصل معنا", "Contact us")}>{summary.contact?.whatsappNumber && <a href={`https://wa.me/${summary.contact.whatsappNumber.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" aria-label="WhatsApp"><ContactIcon name="whatsapp" /> <span>WhatsApp</span></a>}{summary.contact?.phoneNumber && <a href={`tel:${summary.contact.phoneNumber}`} aria-label={tx(language, "اتصال", "Call")}><ContactIcon name="phone" /> <span>{tx(language, "اتصال", "Call")}</span></a>}</div>}
    </div>
  );
}

function PortalIcon({ name }: { name: View | "more" | "close" | "logout" | "chat" | "phone" | "refresh" }) {
  const paths = {
    chat: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z",
    phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1Z",
    overview: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
    calendar: "M3 5h18v16H3z M8 3v4 M16 3v4 M3 10h18",
    content: "M4 3h16v18H4z M4 8h16 M9 3v5 M15 3v5 m-5 5 5 3-5 3z",
    sessions: "M3 7h4l2-3h6l2 3h4v13H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    billing: "M4 3h16v18l-4-2-4 2-4-2-4 2z M8 8h8 M8 12h8 M8 16h3",
    services: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z",
    archive: "M3 3h18v5H3z M5 8v13h14V8 M10 12h4",
    more: "M5 12h.01 M12 12h.01 M19 12h.01",
    close: "m6 6 12 12 M6 18 18 6",
    logout: "M9 4H4v16h5 M10 12h11 m-4-4 4 4-4 4",
    refresh: "M20 6v5h-5 M4 18v-5h5 M6.1 9a7 7 0 0 1 11.8-2.6L20 11 M4 13l2.1 4.6A7 7 0 0 0 17.9 15",
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3.5 : 1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function ContactIcon({ name }: { name: "whatsapp" | "phone" }) {
  if (name === "whatsapp") {
    return <svg className="contact-icon contact-icon-whatsapp" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.5 3.5A11.8 11.8 0 0 0 12.08 0C5.55 0 .24 5.3.24 11.83c0 2.08.54 4.11 1.57 5.9L.14 24l6.42-1.64a11.8 11.8 0 0 0 5.52 1.37h.01c6.53 0 11.84-5.31 11.84-11.84 0-3.17-1.23-6.14-3.43-8.39ZM12.1 21.73h-.01a9.86 9.86 0 0 1-5.03-1.38l-.36-.21-3.81.98 1.02-3.71-.23-.38a9.83 9.83 0 0 1-1.51-5.2C2.17 6.39 6.62 1.94 12.09 1.94a9.79 9.79 0 0 1 6.97 2.89 9.82 9.82 0 0 1 2.9 6.99c0 5.47-4.45 9.91-9.86 9.91Zm5.43-7.42c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.27-.47-2.42-1.5-.9-.8-1.51-1.78-1.69-2.08-.18-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.1 4.49.71.31 1.27.5 1.7.64.71.23 1.35.2 1.86.12.57-.09 1.76-.72 2.01-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35Z" /></svg>;
  }
  return <svg className="contact-icon contact-icon-phone" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1Z" /></svg>;
}

function PortalNavigation({ view, onNavigate, language }: { view: View; onNavigate: (view: View) => void; language: Language }) {
  return <>
    <nav className={styles.desktopNav} aria-label="أقسام بوابة العملاء">
      {navigation.map((item) => <button key={item.id} type="button" className={view === item.id ? styles.active : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => onNavigate(item.id)}><PortalIcon name={item.id} />{language === "ar" ? item.ar : item.en}</button>)}
    </nav>
    <nav className={styles.mobileNav} aria-label="التنقل الرئيسي">
      {navigation.map((item) => <button key={item.id} type="button" className={view === item.id ? styles.active : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => onNavigate(item.id)}><span className={styles.navIcon}><PortalIcon name={item.id} /></span><span>{language === "ar" ? item.ar : item.en}</span></button>)}
    </nav>
  </>;
}

function PortalLogin({ onLogin, language, onLanguage }: { onLogin: () => Promise<void>; language: Language; onLanguage: (language: Language) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/portal/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "تعذر تسجيل الدخول");
      await onLogin();
    } catch (loginError) {
      setError((loginError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.login} dir={language === "ar" ? "rtl" : "ltr"} lang={language}>
      <section className={styles.loginIntro}>
        <OzmoBrand />
        <div className={styles.loginStory}><small>{tx(language, "بوابة عملاء OZMO", "OZMO Client Portal")}</small><h1>{language === "ar" ? <>كل شيء واضح.<br />كل شهر.</> : <>Everything is clear.<br />Every month.</>}</h1><p>{tx(language, "المحتوى، جلسات التصوير والفواتير في مكان واحد.", "Content, photo sessions, and billing in one place.")}</p></div>
        <div className={styles.loginProof}><span>{tx(language, "بيانات مباشرة", "Live data")}</span><span>{tx(language, "مساحة خاصة", "Private space")}</span><span>{tx(language, "تجربة سهلة", "Simple experience")}</span></div>
      </section>
      <form className={styles.loginCard} onSubmit={submit}>
        <button className={styles.loginLanguage} type="button" onClick={() => onLanguage(language === "ar" ? "en" : "ar")}>{language === "ar" ? "English" : "العربية"}</button>
        <span className={styles.eyebrow}>{tx(language, "دخول آمن", "Secure login")}</span>
        <h2>{tx(language, "أهلاً بعودتك", "Welcome back")}</h2>
        <p>{tx(language, "استخدم بيانات الدخول التي استلمتها من فريق OZMO.", "Use the login details provided by the OZMO team.")}</p>
        <label>{tx(language, "البريد الإلكتروني", "Email")}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
        <label>{tx(language, "كلمة المرور", "Password")}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        {error && <div className={styles.error}>{error}</div>}
        <button disabled={busy} type="submit">{busy ? tx(language, "جارٍ الدخول…", "Signing in…") : tx(language, "دخول إلى البوابة", "Open portal")}</button>
      </form>
    </main>
  );
}

function OverviewLegacy({ summary, language }: { summary: PortalSummary; language: Language }) {
  return <div className={styles.page}>
    <PageHeading title={tx(language, "نظرة عامة", "Overview")} month={summary.month} language={language} />
    <section className={styles.clientHero}>
      {summary.client.logoUrl && <ClientMark name={summary.client.name} logoUrl={summary.client.logoUrl} />}
      <div><h2>{summary.client.name}</h2></div>
    </section>
    <section className={`${styles.metrics} ${styles.overviewMetrics}`}>
      <Metric label={tx(language, "تم نشره", "Published")} value={summary.content.published} detail={tx(language, "هذا الشهر", "This month")} tone="green" />
      <Metric label={tx(language, "بانتظار المونتاج", "Awaiting editing")} value={summary.content.inventory.shotReels} detail={tx(language, "مواد مصورة", "Shot content")} tone="blue" />
      <Metric label={tx(language, "جاهز للنشر", "Ready to publish")} value={summary.content.inventory.readyReels + summary.content.inventory.readyPosts + summary.content.inventory.readyStories} detail={language === "ar" ? `${summary.content.inventory.readyReels} ريل · ${summary.content.inventory.readyPosts} منشور · ${summary.content.inventory.readyStories} ستوري` : `${summary.content.inventory.readyReels} reels · ${summary.content.inventory.readyPosts} posts · ${summary.content.inventory.readyStories} stories`} tone="blue" />
      <Metric label={tx(language, "المبلغ المتبقي", "Remaining balance")} value={formatMoney(summary.client.remainingPaymentCents, summary.client.remainingPaymentCurrency)} detail={summary.client.remainingPaymentCents > 0 ? tx(language, "مستحق للدفع", "Due for payment") : tx(language, "لا توجد مستحقات", "No balance due")} tone="dark" />
    </section>
    {summary.client.googleDriveUrl && (
      <a className={styles.driveLink} href={summary.client.googleDriveUrl} target="_blank" rel="noreferrer">
        <span className={styles.driveIcon} aria-hidden="true">↗</span>
        <span><strong>ملفاتكم على Google Drive</strong><small>فتح مجلد الملفات المشتركة</small></span>
        <span aria-hidden="true">←</span>
      </a>
    )}
    <section className={styles.grid}>
      <article className={styles.card}>
        <header><h2>التصوير القادم</h2><PortalIcon name="sessions" /></header>
        {summary.upcomingSession ? <div className={styles.session}><span>◷</span><strong>{formatDate(summary.upcomingSession.scheduledAt, true)}</strong><p>جلسة تصوير مجدولة مع فريق OZMO</p></div> : <Empty text="لا توجد جلسة تصوير مجدولة حالياً." />}
      </article>
    </section>
    <article className={`${styles.card} ${styles.kpiCard}`}>
      <header>
        <h2>أهداف الشهر</h2>
        <span className={styles.kpiProgress}>
          {summary.monthlyKpis.filter((goal) => goal.completed).length} / {summary.monthlyKpis.length} مكتمل
        </span>
      </header>
      {summary.monthlyKpis.length === 0 ? (
        <Empty text="لم تُضف أهداف لهذا الشهر بعد." />
      ) : (
        <div className={styles.kpiList}>
          {summary.monthlyKpis.map((goal) => (
            <div className={`${styles.kpiItem} ${goal.completed ? styles.kpiCompleted : ""}`} key={goal.id}>
              <span aria-hidden="true">{goal.completed ? "✓" : "○"}</span>
              <div><strong>{goal.goal}</strong><small>{goal.completed ? "تم تحقيق الهدف" : "قيد العمل"}</small></div>
            </div>
          ))}
        </div>
      )}
    </article>
  </div>;
}

const PORTAL_CALENDAR_STATUS = { planned: "مجدول", ready: "جاهز", link_added: "بانتظار المراجعة", viewed: "تمت المشاهدة", published: "تم النشر" } as const;

function portalMonthCells(month: string) { const [year, value] = month.split("-").map(Number); const first = new Date(Date.UTC(year, value - 1, 1)); const start = new Date(first); start.setUTCDate(1 - first.getUTCDay()); return Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setUTCDate(start.getUTCDate() + index); return { key: date.toISOString().slice(0, 10), day: date.getUTCDate(), inMonth: date.getUTCMonth() === value - 1 }; }); }
function shiftPortalMonth(month: string, amount: number) { const [year, value] = month.split("-").map(Number); const date = new Date(Date.UTC(year, value - 1 + amount, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }

function Overview({ summary, language }: { summary: PortalSummary; language: Language }) {
  if (language === "ar") return <OverviewLegacy summary={summary} language={language} />;
  return <div className={styles.page}><PageHeading title="Overview" month={summary.month} language={language} /><section className={styles.clientHero}>{summary.client.logoUrl && <ClientMark name={summary.client.name} logoUrl={summary.client.logoUrl} />}<div><h2>{summary.client.name}</h2></div></section><section className={`${styles.metrics} ${styles.overviewMetrics}`}><Metric label="Published" value={summary.content.published} detail="This month" tone="green" /><Metric label="Awaiting editing" value={summary.content.inventory.shotReels} detail="Shot content" tone="blue" /><Metric label="Ready to publish" value={summary.content.inventory.readyReels + summary.content.inventory.readyPosts + summary.content.inventory.readyStories} detail={`${summary.content.inventory.readyReels} reels · ${summary.content.inventory.readyPosts} posts · ${summary.content.inventory.readyStories} stories`} tone="blue" /><Metric label="Remaining balance" value={formatMoney(summary.client.remainingPaymentCents, summary.client.remainingPaymentCurrency)} detail={summary.client.remainingPaymentCents > 0 ? "Due for payment" : "No balance due"} tone="dark" /></section>{summary.client.googleDriveUrl && <a className={styles.driveLink} href={summary.client.googleDriveUrl} target="_blank" rel="noreferrer"><span className={styles.driveIcon}>↗</span><span><strong>Your Google Drive files</strong><small>Open the shared files folder</small></span><span>←</span></a>}<section className={styles.grid}><article className={styles.card}><header><h2>Upcoming session</h2><PortalIcon name="sessions" /></header>{summary.upcomingSession ? <div className={styles.session}><span>◷</span><strong>{formatDate(summary.upcomingSession.scheduledAt, true, language)}</strong><p>A photo session scheduled with the OZMO team</p></div> : <Empty text="No photo session is currently scheduled." />}</article></section><article className={`${styles.card} ${styles.kpiCard}`}><header><h2>Monthly goals</h2><span className={styles.kpiProgress}>{summary.monthlyKpis.filter((goal) => goal.completed).length} / {summary.monthlyKpis.length} complete</span></header>{summary.monthlyKpis.length === 0 ? <Empty text="No goals have been added for this month yet." /> : <div className={styles.kpiList}>{summary.monthlyKpis.map((goal) => <div className={`${styles.kpiItem} ${goal.completed ? styles.kpiCompleted : ""}`} key={goal.id}><span>{goal.completed ? "✓" : "○"}</span><div><strong>{goal.goal}</strong><small>{goal.completed ? "Goal completed" : "In progress"}</small></div></div>)}</div>}</article></div>;
}

function Calendar({ calendar, month, onMonth, onChanged, language }: { calendar: PortalCalendar | null; month: string; onMonth: (month: string) => void; onChanged: () => Promise<void>; language: Language }) {
  async function openReview(itemId: string) {
    const tab = window.open("", "_blank");
    const response = await fetch("/api/portal/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId }) });
    const body = await response.json().catch(() => ({})) as { url?: string; error?: string };
    if (!response.ok || !body.url) { tab?.close(); return; }
    if (tab) tab.location.replace(body.url); else window.location.assign(body.url);
    await onChanged();
  }
  if (!calendar?.enabled) return <div className={styles.page}><PageHeading title={tx(language, "التقويم", "Calendar")} language={language} /><article className={styles.card}><Empty text={tx(language, "لم يتم تفعيل تقويم المحتوى لهذا الحساب بعد.", "The content calendar has not been enabled for this account yet.")} /></article></div>;
  const cells = portalMonthCells(month); const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Damascus" }).format(new Date());
  const weekdays = language === "ar" ? ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"] : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return <div className={styles.page}><header className={styles.calendarPageHeader}><h1>{tx(language, "تقويم المحتوى", "Content calendar")}</h1><div><button type="button" onClick={() => onMonth(shiftPortalMonth(month, -1))} aria-label={tx(language, "الشهر السابق", "Previous month")}>›</button><span>{monthLabel(month, language)}</span><button type="button" onClick={() => onMonth(shiftPortalMonth(month, 1))} aria-label={tx(language, "الشهر التالي", "Next month")}>‹</button></div></header>{calendar.notifications.some((item) => !item.read) && <section className={styles.calendarNotifications}>{calendar.notifications.filter((item) => !item.read).map((notice) => <button type="button" key={notice.id} onClick={() => notice.itemId && document.getElementById(`calendar-${notice.itemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}><strong>{language === "ar" ? notice.titleAr : notice.titleEn}</strong><span>{language === "ar" ? notice.messageAr : notice.messageEn}</span></button>)}</section>}<div className={styles.portalCalendarLegend}>{Object.entries(PORTAL_CALENDAR_STATUS).map(([status,label]) => <span className={styles[`legend_${status}`]} key={status}><i />{language === "ar" ? label : ({ planned: "Scheduled", ready: "Ready", link_added: "Awaiting review", viewed: "Viewed", published: "Published" } as Record<string,string>)[status]}</span>)}</div><div className={styles.portalCalendarScroll}><section className={styles.portalRealCalendar}><header>{weekdays.map((day) => <strong key={day}>{day}</strong>)}</header><div>{cells.map((cell) => { const dayItems = calendar.items.filter((item) => item.date === cell.key); return <article className={`${styles.portalCalendarDay} ${!cell.inMonth ? styles.outsideMonth : ""} ${cell.key === today ? styles.today : ""}`} key={cell.key}><time>{cell.day}</time><section>{dayItems.map((item) => <button id={`calendar-${item.id}`} type="button" className={`${styles.portalCalendarEvent} ${styles[`event_${item.status}`]}`} key={item.id} onClick={() => item.hasReviewLink && void openReview(item.id)}><b>{item.contentType === "reel" ? tx(language, "ريل", "Reel") : tx(language, "منشور", "Post")}</b><span>{language === "ar" ? PORTAL_CALENDAR_STATUS[item.status] : ({ planned: "Scheduled", ready: "Ready", link_added: "Awaiting review", viewed: "Viewed", published: "Published" } as Record<string,string>)[item.status]}</span>{item.hasReviewLink && <em>{tx(language, "عرض", "View")}</em>}</button>)}</section></article>; })}</div></section></div></div>;
}

function ContentLegacy({ summary, language }: { summary: PortalSummary; language: Language }) {
  return <div className={styles.page}>
    <PageHeading title={tx(language, "المحتوى", "Content")} month={summary.month} language={language} />
    <section className={styles.metrics}>
      <Metric label="تم نشره" value={summary.content.published} detail="هذا الشهر" tone="green" />
      <Metric label="جاهز" value={summary.content.inventory.readyReels + summary.content.inventory.readyPosts + summary.content.inventory.readyStories} detail="للنشر" tone="blue" />
      <Metric label="قيد التجهيز" value={summary.content.inventory.shotReels + summary.content.inventory.drafts} detail="مسودات ومواد مصورة" tone="dark" />
    </section>
    <article className={styles.card}>
      <header><div><small>السجل</small><h2>آخر نشاطات المحتوى</h2></div></header>
      {summary.recentActivity.length ? <div className={styles.activity}>{summary.recentActivity.map((item) => <div key={item.id}><span>{actionIcon(item.action)}</span><div><strong>{actionLabel(item.action, item.quantity)}</strong><small>{formatDate(item.occurredOn)}</small></div><em>{item.status === "completed" ? "مكتمل" : "قيد التنفيذ"}</em></div>)}</div> : <Empty text="لم يسجل نشاط محتوى لهذا الشهر بعد." />}
    </article>
  </div>;
}

function Content({ summary, language }: { summary: PortalSummary; language: Language }) {
  if (language === "ar") return <ContentLegacy summary={summary} language={language} />;
  return <div className={styles.page}><PageHeading title="Content" month={summary.month} language={language} /><section className={styles.metrics}><Metric label="Published" value={summary.content.published} detail="This month" tone="green" /><Metric label="Ready" value={summary.content.inventory.readyReels + summary.content.inventory.readyPosts + summary.content.inventory.readyStories} detail="For publishing" tone="blue" /><Metric label="In progress" value={summary.content.inventory.shotReels + summary.content.inventory.drafts} detail="Drafts and shot content" tone="dark" /></section><article className={styles.card}><header><div><small>Activity</small><h2>Latest content activity</h2></div></header>{summary.recentActivity.length ? <div className={styles.activity}>{summary.recentActivity.map((item) => <div key={item.id}><span>{actionIcon(item.action)}</span><div><strong>{actionLabel(item.action, item.quantity, language)}</strong><small>{formatDate(item.occurredOn, false, language)}</small></div><em>{item.status === "completed" ? "Completed" : "In progress"}</em></div>)}</div> : <Empty text="No content activity has been recorded this month yet." />}</article></div>;
}

function SessionsLegacy({ summary, language }: { summary: PortalSummary; language: Language }) {
  return <div className={styles.page}>
    <PageHeading title={tx(language, "جلسات التصوير", "Photo sessions")} month={summary.month} language={language} />
    <section className={styles.grid}>
      <article className={styles.card}><header><div><small>الموعد القادم</small><h2>جلسة التصوير</h2></div></header>{summary.upcomingSession ? <div className={styles.session}><span>◷</span><strong>{formatDate(summary.upcomingSession.scheduledAt, true)}</strong><p>سيتم التواصل معكم لتأكيد التفاصيل.</p></div> : <Empty text="لا توجد جلسة مجدولة حالياً." />}</article>
      <article className={styles.card}><header><div><small>المواد المصورة</small><h2>بانتظار المونتاج</h2></div></header><div className={styles.bigNumber}>{summary.content.inventory.shotReels}<small>ريل مصور</small></div></article>
    </section>
  </div>;
}

function Sessions({ summary, language }: { summary: PortalSummary; language: Language }) {
  if (language === "ar") return <SessionsLegacy summary={summary} language={language} />;
  return <div className={styles.page}><PageHeading title="Photo sessions" month={summary.month} language={language} /><section className={styles.grid}><article className={styles.card}><header><div><small>Next appointment</small><h2>Photo session</h2></div></header>{summary.upcomingSession ? <div className={styles.session}><span>◷</span><strong>{formatDate(summary.upcomingSession.scheduledAt, true, language)}</strong><p>We will contact you to confirm the details.</p></div> : <Empty text="No session is currently scheduled." />}</article><article className={styles.card}><header><div><small>Shot content</small><h2>Awaiting editing</h2></div></header><div className={styles.bigNumber}>{summary.content.inventory.shotReels}<small>Shot reels</small></div></article></section></div>;
}

function Billing({ summary, language }: { summary: PortalSummary; language: Language }) {
  return <div className={styles.page}>
    <PageHeading title={tx(language, "الدفعات", "Billing")} language={language} />
    <article className={`${styles.card} ${styles.invoice}`}><header><h2>{tx(language, "المبلغ المتبقي", "Remaining balance")}</h2><em className={summary.client.remainingPaymentCents > 0 ? styles.unpaid : styles.paid}>{summary.client.remainingPaymentCents > 0 ? tx(language, "مستحق للدفع", "Due for payment") : tx(language, "لا توجد مستحقات", "No balance due")}</em></header><strong dir="ltr">{formatMoney(summary.client.remainingPaymentCents, summary.client.remainingPaymentCurrency)}</strong></article><article className={styles.card} style={{marginTop:20}}><header><h2>{tx(language, "سجل الدفعات", "Payment history")}</h2></header><PaymentHistory payments={summary.payments ?? []} arabic={language === "ar"} /></article>
  </div>;
}

function Services({ language }: { language: Language }) {
  const services = [
    ["تطوير الويب", "مواقع سريعة ومرنة تمثل علامتكم بشكل احترافي.", "↗"],
    ["الهوية البصرية", "نظام علامة متكامل وواضح يليق بطموحكم.", "✦"],
    ["إعلانات Meta", "حملات مدروسة للوصول إلى الجمهور المناسب.", "◉"],
    ["جلسات التصوير", "محتوى متسق تستخدمونه في كل قنواتكم.", "◌"],
    ["حملات البلوجرز", "نربط علامتكم بمؤثرين مناسبين لجمهوركم.", "◎"],
    ["حملات UGC", "محتوى عفوي يركز على التجربة والثقة.", "♡"],
  ];
  return <div className={styles.page}><PageHeading title={tx(language, "خدماتنا", "Our services")} language={language} /><section className={styles.servicesGrid}>{services.map(([title, copy, icon]) => <article className={styles.serviceCard} key={title}><span>{icon}</span><h2>{language === "ar" ? title : ({"تطوير الويب":"Web development","الهوية البصرية":"Branding","إعلانات Meta":"Meta ads","جلسات التصوير":"Photo sessions","حملات البلوجرز":"Blogger campaigns","حملات UGC":"UGC campaigns"} as Record<string,string>)[title] ?? title}</h2><p>{language === "ar" ? copy : "Professional support designed around your brand and growth."}</p></article>)}</section></div>;
}

function Archive({ archives, language }: { archives: PortalArchive[]; language: Language }) {
  const [selected, setSelected] = useState(archives[0]?.id ?? "");
  useEffect(() => { if (!archives.some((archive) => archive.id === selected)) setSelected(archives[0]?.id ?? ""); }, [archives, selected]);
  const archive = archives.find((item) => item.id === selected) ?? archives[0];
  return <div className={styles.page}><PageHeading title={tx(language, "الأرشيف", "Archive")} language={language} />{!archive ? <article className={`${styles.card} ${styles.emptyArchive}`}><span>↺</span><h2>{tx(language, "لا توجد أشهر مؤرشفة بعد", "No archived months yet")}</h2><p>{tx(language, "ستظهر الأرقام هنا عند إغلاق الشهر.", "Numbers will appear here when a month is closed.")}</p></article> : <><label className={styles.archivePicker}>{tx(language, "اختر الشهر", "Choose month")}<select value={archive.id} onChange={(event) => setSelected(event.target.value)}>{archives.map((item) => <option value={item.id} key={item.id}>{monthLabel(item.month, language)}</option>)}</select></label><section className={styles.metrics}><Metric label={tx(language, "المنتج", "Produced")} value={archive.content.produced} detail={tx(language, "خلال الشهر", "This month")} tone="orange" /><Metric label={tx(language, "المنشور", "Published")} value={archive.content.published} detail={tx(language, "محتوى منشور", "Published content")} tone="green" /><Metric label={tx(language, "المهام", "Tasks")} value={archive.taskCount} detail={tx(language, "مهمة مسجلة", "Recorded tasks")} tone="blue" /><Metric label={tx(language, "ريل جاهز", "Ready reels")} value={archive.inventory.readyReels} detail={tx(language, "في نهاية الشهر", "At month end")} tone="dark" /></section><article className={styles.card}><header><div><small>{tx(language, "الرصيد المؤرشف", "Archived balance")}</small><h2>{monthLabel(archive.month, language)}</h2></div><span className={styles.monthChip}>{archive.startDate} → {archive.endDate}</span></header><div className={styles.archiveGrid}>{([["المسودات", archive.inventory.drafts], ["ريل مصور", archive.inventory.shotReels], ["ريل جاهز", archive.inventory.readyReels], ["المنشورات", archive.inventory.readyPosts]] as [string, number][]).map(([label, value]) => <div key={label}><span>{language === "ar" ? label : ({"المسودات":"Drafts","ريل مصور":"Shot reels","ريل جاهز":"Ready reels","المنشورات":"Posts"} as Record<string,string>)[label]}</span><strong>{value}</strong></div>)}</div>{archive.notes && <p className={styles.archiveNote}>{archive.notes}</p>}</article></>}</div>;
}

function PageHeading({ title, month, language = "ar" }: { title: string; month?: string; language?: Language }) { return <header className={styles.pageHeading}><h1 tabIndex={-1}>{title}</h1>{month && <span className={styles.monthChip}>{monthLabel(month, language)}</span>}</header>; }
function Metric({ label, value, detail, tone }: { label: string; value: number | string; detail: string; tone: string }) { return <article className={`${styles.metric} ${styles[tone]}`}><small>{label}</small><strong dir="ltr">{value}</strong><span>{detail}</span></article>; }
function Empty({ text }: { text: string }) { return <div className={styles.empty}><p>{text}</p></div>; }
function PortalLoading({ compact = false, language = "ar" }: { compact?: boolean; language?: Language }) { return <div className={compact ? styles.compactLoading : styles.loading} dir={language === "ar" ? "rtl" : "ltr"} role="status"><OzmoBrand /><p>{tx(language, "جارٍ التحميل…", "Loading…")}</p></div>; }

function OzmoBrand() {
  return <div className={styles.brand} aria-label="OZMO" role="img"><span className={styles.brandLogo} aria-hidden="true" /></div>;
}

function ClientMark({ name, logoUrl, compact = false }: { name: string; logoUrl?: string | null; compact?: boolean }) {
  return <span className={`${styles.clientLogo} ${compact ? styles.compactLogo : ""}`}>
    {logoUrl ? <Image src={logoUrl} alt={`شعار ${name}`} width={84} height={84} unoptimized /> : name.slice(0, 1)}
  </span>;
}

function currentMonth() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Damascus", year: "numeric", month: "2-digit" }).format(new Date()); }
async function enablePortalNotifications(setBusy: (busy: boolean) => void, done: () => void) {
  setBusy(true);
  try {
    const permission = await Notification.requestPermission(); if (permission !== "granted") return;
    const registration = await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready;
    const configResponse = await fetch("/api/portal/push", { cache: "no-store" }); const config = await configResponse.json() as { publicKey?: string };
    if (!config.publicKey) throw new Error("Push is not configured");
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64Key(config.publicKey) });
    await fetch("/api/portal/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: subscription.toJSON(), deviceLabel: navigator.userAgent, platform: navigator.platform }) });
    done();
  } finally { setBusy(false); }
}
function base64Key(value: string) { const padding = "=".repeat((4 - value.length % 4) % 4); const decoded = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(decoded, (character) => character.charCodeAt(0)); }
function formatDate(value: string, withTime = false, language: Language = "ar") { const date = new Date(value); if (Number.isNaN(date.getTime())) return value; return new Intl.DateTimeFormat(language === "ar" ? "ar-SY" : "en-US", { timeZone: "Asia/Damascus", day: "numeric", month: "long", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) }).format(date); }
function monthLabel(value: string, language: Language = "ar") { const [year, month] = value.split("-").map(Number); return new Intl.DateTimeFormat(language === "ar" ? "ar-SY" : "en-US", { month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, 1))); }
function tx(language: Language, ar: string, en: string) { return language === "ar" ? ar : en; }
function formatMoney(cents: number, currency: string) {
  const amount = Math.round(Number(cents) / 100);
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(amount);
  return currency ? `${formatted} ${currency.toUpperCase()}` : formatted;
}
function actionLabel(action: string, quantity: number, language: Language = "ar") { const labelsAr: Record<string, string> = { reel_new: "إنتاج ريل جديد", post_new: "إنتاج منشور جديد", publish_reel: "نشر ريل", publish_post: "نشر منشور", draft_created: "إعداد مسودة", reel_reedit: "تعديل ريل" }; const labelsEn: Record<string, string> = { reel_new: "New reel produced", post_new: "New post produced", publish_reel: "Reel published", publish_post: "Post published", draft_created: "Draft created", reel_reedit: "Reel revised" }; const labels = language === "ar" ? labelsAr : labelsEn; return `${labels[action] ?? (language === "ar" ? "تحديث المحتوى" : "Content update")} · ${quantity}`; }
function actionIcon(action: string) { return action.startsWith("publish") ? "↑" : action.includes("reel") ? "▶" : "◆"; }
