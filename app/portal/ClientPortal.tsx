"use client";
/* eslint-disable react-hooks/set-state-in-effect -- this effect hydrates the authenticated server-backed portal */

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import styles from "./portal.module.css";

type View = "overview" | "content" | "sessions" | "services" | "archive" | "billing";

type PortalUser = {
  id: number;
  email: string;
  displayName: string;
  clientId: number;
  ozmoClientId: string;
  clientName: string;
};

type PortalSummary = {
  client: {
    id: string;
    ozmoClientId: string;
    name: string;
    logoUrl?: string | null;
    remainingPaymentCents: number;
    remainingPaymentCurrency: string;
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

const navigation: Array<{ id: View; label: string; mobileLabel: string }> = [
  { id: "overview", label: "نظرة عامة", mobileLabel: "الرئيسية" },
  { id: "billing", label: "الدفعات", mobileLabel: "الدفعات" },
  { id: "services", label: "خدماتنا", mobileLabel: "خدماتنا" },
  { id: "archive", label: "الأرشيف", mobileLabel: "الأرشيف" },
];

export default function ClientPortal() {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [summary, setSummary] = useState<PortalSummary | null>(null);
  const [archives, setArchives] = useState<PortalArchive[]>([]);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const workspaceRef = useRef<HTMLElement>(null);
  const previousView = useRef(view);
  const month = currentMonth();

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
      const [summaryResponse, archiveResponse] = await Promise.all([
        fetch(`/api/portal/summary?month=${month}`, { cache: "no-store" }),
        fetch("/api/portal/archive", { cache: "no-store" }),
      ]);
      if (!summaryResponse.ok) throw new Error("تعذر تحميل بيانات المحتوى حالياً");
      setSummary((await summaryResponse.json()) as PortalSummary);
      if (archiveResponse.ok) {
        setArchives(((await archiveResponse.json()) as { archives: PortalArchive[] }).archives);
      } else {
        setArchives([]);
      }
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
    if (previousView.current === view) return;
    previousView.current = view;
    workspaceRef.current?.querySelector("h1")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view]);

  if (loading && !user) return <PortalLoading />;
  if (!user) return <PortalLogin onLogin={loadPortal} />;

  async function logout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    setUser(null);
    setSummary(null);
    setArchives([]);
  }

  return (
    <div className={styles.portal} dir="rtl" lang="ar">
      <header className={styles.shellHeader}>
        <div className={styles.headerIdentity} title={user.clientName}>
          <ClientMark name={user.clientName} logoUrl={summary?.client.logoUrl} compact />
          <strong>{user.clientName}</strong>
        </div>
        <OzmoBrand />
        <button className={styles.logout} onClick={() => void logout()} type="button" aria-label="تسجيل الخروج">
          <PortalIcon name="logout" /><span>خروج</span>
        </button>
      </header>
      <PortalNavigation view={view} onNavigate={setView} />

      <main className={styles.workspace} ref={workspaceRef} key={view} id="portal-content" aria-busy={loading}>
        {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={() => void loadPortal()}>إعادة المحاولة</button></div>}
        {!summary ? (
          <PortalLoading compact />
        ) : view === "overview" ? (
          <Overview summary={summary} />
        ) : view === "content" ? (
          <Content summary={summary} />
        ) : view === "sessions" ? (
          <Sessions summary={summary} />
        ) : view === "services" ? (
          <Services />
        ) : view === "archive" ? (
          <Archive archives={archives} />
        ) : (
          <Billing summary={summary} />
        )}
      </main>
    </div>
  );
}

function PortalIcon({ name }: { name: View | "more" | "close" | "logout" }) {
  const paths = {
    overview: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
    content: "M4 3h16v18H4z M4 8h16 M9 3v5 M15 3v5 m-5 5 5 3-5 3z",
    sessions: "M3 7h4l2-3h6l2 3h4v13H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    billing: "M4 3h16v18l-4-2-4 2-4-2-4 2z M8 8h8 M8 12h8 M8 16h3",
    services: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z",
    archive: "M3 3h18v5H3z M5 8v13h14V8 M10 12h4",
    more: "M5 12h.01 M12 12h.01 M19 12h.01",
    close: "m6 6 12 12 M6 18 18 6",
    logout: "M9 4H4v16h5 M10 12h11 m-4-4 4 4-4 4",
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3.5 : 1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function PortalNavigation({ view, onNavigate }: { view: View; onNavigate: (view: View) => void }) {
  return <>
    <nav className={styles.desktopNav} aria-label="أقسام بوابة العملاء">
      {navigation.map((item) => <button key={item.id} type="button" className={view === item.id ? styles.active : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => onNavigate(item.id)}><PortalIcon name={item.id} />{item.label}</button>)}
    </nav>
    <nav className={styles.mobileNav} aria-label="التنقل الرئيسي">
      {navigation.map((item) => <button key={item.id} type="button" className={view === item.id ? styles.active : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => onNavigate(item.id)}><span className={styles.navIcon}><PortalIcon name={item.id} /></span><span>{item.mobileLabel}</span></button>)}
    </nav>
  </>;
}

function PortalLogin({ onLogin }: { onLogin: () => Promise<void> }) {
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
    <main className={styles.login} dir="rtl" lang="ar">
      <section className={styles.loginIntro}>
        <OzmoBrand />
        <div className={styles.loginStory}><small>بوابة عملاء OZMO</small><h1>كل شيء واضح.<br />كل شهر.</h1><p>المحتوى، جلسات التصوير والفواتير في مكان واحد.</p></div>
        <div className={styles.loginProof}><span>بيانات مباشرة</span><span>مساحة خاصة</span><span>تجربة سهلة</span></div>
      </section>
      <form className={styles.loginCard} onSubmit={submit}>
        <span className={styles.eyebrow}>دخول آمن</span>
        <h2>أهلاً بعودتك</h2>
        <p>استخدم بيانات الدخول التي استلمتها من فريق OZMO.</p>
        <label>البريد الإلكتروني<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
        <label>كلمة المرور<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        {error && <div className={styles.error}>{error}</div>}
        <button disabled={busy} type="submit">{busy ? "جارٍ الدخول…" : "دخول إلى البوابة"}</button>
      </form>
    </main>
  );
}

function Overview({ summary }: { summary: PortalSummary }) {
  return <div className={styles.page}>
    <PageHeading title="نظرة عامة" month={summary.month} />
    <section className={`${styles.metrics} ${styles.overviewMetrics}`}>
      <Metric label="تم إنتاجه" value={summary.content.produced} detail="هذا الشهر" tone="orange" />
      <Metric label="تم نشره" value={summary.content.published} detail="هذا الشهر" tone="green" />
      <Metric label="بانتظار المونتاج" value={summary.content.inventory.shotReels} detail="مواد مصورة" tone="blue" />
      <Metric label="جاهز للنشر" value={summary.content.inventory.readyReels + summary.content.inventory.readyPosts} detail={`${summary.content.inventory.readyReels} ريل · ${summary.content.inventory.readyPosts} منشور`} tone="blue" />
      <Metric label="المبلغ المتبقي" value={formatMoney(summary.client.remainingPaymentCents, summary.client.remainingPaymentCurrency)} detail={summary.client.remainingPaymentCents > 0 ? "مستحق للدفع" : "لا توجد مستحقات"} tone="dark" />
    </section>
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

function Content({ summary }: { summary: PortalSummary }) {
  return <div className={styles.page}>
    <PageHeading title="المحتوى" month={summary.month} />
    <section className={styles.metrics}>
      <Metric label="تم إنتاجه" value={summary.content.produced} detail="هذا الشهر" tone="orange" />
      <Metric label="تم نشره" value={summary.content.published} detail="هذا الشهر" tone="green" />
      <Metric label="جاهز" value={summary.content.inventory.readyReels + summary.content.inventory.readyPosts} detail="للنشر" tone="blue" />
      <Metric label="قيد التجهيز" value={summary.content.inventory.shotReels + summary.content.inventory.drafts} detail="مسودات ومواد مصورة" tone="dark" />
    </section>
    <article className={styles.card}>
      <header><div><small>السجل</small><h2>آخر نشاطات المحتوى</h2></div></header>
      {summary.recentActivity.length ? <div className={styles.activity}>{summary.recentActivity.map((item) => <div key={item.id}><span>{actionIcon(item.action)}</span><div><strong>{actionLabel(item.action, item.quantity)}</strong><small>{formatDate(item.occurredOn)}</small></div><em>{item.status === "completed" ? "مكتمل" : "قيد التنفيذ"}</em></div>)}</div> : <Empty text="لم يسجل نشاط محتوى لهذا الشهر بعد." />}
    </article>
  </div>;
}

function Sessions({ summary }: { summary: PortalSummary }) {
  return <div className={styles.page}>
    <PageHeading title="جلسات التصوير" month={summary.month} />
    <section className={styles.grid}>
      <article className={styles.card}><header><div><small>الموعد القادم</small><h2>جلسة التصوير</h2></div></header>{summary.upcomingSession ? <div className={styles.session}><span>◷</span><strong>{formatDate(summary.upcomingSession.scheduledAt, true)}</strong><p>سيتم التواصل معكم لتأكيد التفاصيل.</p></div> : <Empty text="لا توجد جلسة مجدولة حالياً." />}</article>
      <article className={styles.card}><header><div><small>المواد المصورة</small><h2>بانتظار المونتاج</h2></div></header><div className={styles.bigNumber}>{summary.content.inventory.shotReels}<small>ريل مصور</small></div></article>
    </section>
  </div>;
}

function Billing({ summary }: { summary: PortalSummary }) {
  return <div className={styles.page}>
    <PageHeading title="الدفعات" />
    <article className={`${styles.card} ${styles.invoice}`}><header><h2>المبلغ المتبقي</h2><em className={summary.client.remainingPaymentCents > 0 ? styles.unpaid : styles.paid}>{summary.client.remainingPaymentCents > 0 ? "مستحق للدفع" : "لا توجد مستحقات"}</em></header><strong dir="ltr">{formatMoney(summary.client.remainingPaymentCents, summary.client.remainingPaymentCurrency)}</strong></article>
  </div>;
}

function Services() {
  const services = [
    ["تطوير الويب", "مواقع سريعة ومرنة تمثل علامتكم بشكل احترافي.", "↗"],
    ["الهوية البصرية", "نظام علامة متكامل وواضح يليق بطموحكم.", "✦"],
    ["إعلانات Meta", "حملات مدروسة للوصول إلى الجمهور المناسب.", "◉"],
    ["جلسات التصوير", "محتوى متسق تستخدمونه في كل قنواتكم.", "◌"],
    ["حملات البلوجرز", "نربط علامتكم بمؤثرين مناسبين لجمهوركم.", "◎"],
    ["حملات UGC", "محتوى عفوي يركز على التجربة والثقة.", "♡"],
  ];
  return <div className={styles.page}><PageHeading title="خدماتنا" /><section className={styles.servicesGrid}>{services.map(([title, copy, icon]) => <article className={styles.serviceCard} key={title}><span>{icon}</span><h2>{title}</h2><p>{copy}</p></article>)}</section></div>;
}

function Archive({ archives }: { archives: PortalArchive[] }) {
  const [selected, setSelected] = useState(archives[0]?.id ?? "");
  useEffect(() => { if (!archives.some((archive) => archive.id === selected)) setSelected(archives[0]?.id ?? ""); }, [archives, selected]);
  const archive = archives.find((item) => item.id === selected) ?? archives[0];
  return <div className={styles.page}><PageHeading title="الأرشيف" />{!archive ? <article className={`${styles.card} ${styles.emptyArchive}`}><span>↺</span><h2>لا توجد أشهر مؤرشفة بعد</h2><p>ستظهر الأرقام هنا عند إغلاق الشهر.</p></article> : <><label className={styles.archivePicker}>اختر الشهر<select value={archive.id} onChange={(event) => setSelected(event.target.value)}>{archives.map((item) => <option value={item.id} key={item.id}>{monthLabel(item.month)}</option>)}</select></label><section className={styles.metrics}><Metric label="المنتج" value={archive.content.produced} detail="خلال الشهر" tone="orange" /><Metric label="المنشور" value={archive.content.published} detail="محتوى منشور" tone="green" /><Metric label="المهام" value={archive.taskCount} detail="مهمة مسجلة" tone="blue" /><Metric label="ريل جاهز" value={archive.inventory.readyReels} detail="في نهاية الشهر" tone="dark" /></section><article className={styles.card}><header><div><small>الرصيد المؤرشف</small><h2>{monthLabel(archive.month)}</h2></div><span className={styles.monthChip}>{archive.startDate} → {archive.endDate}</span></header><div className={styles.archiveGrid}>{([["المسودات", archive.inventory.drafts], ["ريل مصور", archive.inventory.shotReels], ["ريل جاهز", archive.inventory.readyReels], ["المنشورات", archive.inventory.readyPosts]] as [string, number][]).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>{archive.notes && <p className={styles.archiveNote}>{archive.notes}</p>}</article></>}</div>;
}

function PageHeading({ title, month }: { title: string; month?: string }) { return <header className={styles.pageHeading}><h1 tabIndex={-1}>{title}</h1>{month && <span className={styles.monthChip}>{monthLabel(month)}</span>}</header>; }
function Metric({ label, value, detail, tone }: { label: string; value: number | string; detail: string; tone: string }) { return <article className={`${styles.metric} ${styles[tone]}`}><small>{label}</small><strong dir="ltr">{value}</strong><span>{detail}</span></article>; }
function Empty({ text }: { text: string }) { return <div className={styles.empty}><p>{text}</p></div>; }
function PortalLoading({ compact = false }: { compact?: boolean }) { return <div className={compact ? styles.compactLoading : styles.loading} dir="rtl" role="status"><OzmoBrand /><p>جارٍ التحميل…</p></div>; }

function OzmoBrand() {
  return <div className={styles.brand} aria-label="OZMO" role="img"><span className={styles.brandLogo} aria-hidden="true" /></div>;
}

function ClientMark({ name, logoUrl, compact = false }: { name: string; logoUrl?: string | null; compact?: boolean }) {
  return <span className={`${styles.clientLogo} ${compact ? styles.compactLogo : ""}`}>
    {logoUrl ? <Image src={logoUrl} alt={`شعار ${name}`} width={84} height={84} unoptimized /> : name.slice(0, 1)}
  </span>;
}

function currentMonth() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Damascus", year: "numeric", month: "2-digit" }).format(new Date()); }
function formatDate(value: string, withTime = false) { const date = new Date(value); if (Number.isNaN(date.getTime())) return value; return new Intl.DateTimeFormat("ar-SY", { timeZone: "Asia/Damascus", day: "numeric", month: "long", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) }).format(date); }
function monthLabel(value: string) { const [year, month] = value.split("-").map(Number); return new Intl.DateTimeFormat("ar-SY", { month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, 1))); }
function formatMoney(cents: number, currency: string) {
  const amount = Math.round(Number(cents) / 100);
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(amount);
  return currency ? `${formatted} ${currency.toUpperCase()}` : formatted;
}
function actionLabel(action: string, quantity: number) { const labels: Record<string, string> = { reel_new: "إنتاج ريل جديد", post_new: "إنتاج منشور جديد", publish_reel: "نشر ريل", publish_post: "نشر منشور", draft_created: "إعداد مسودة", reel_reedit: "تعديل ريل" }; return `${labels[action] ?? "تحديث المحتوى"} · ${quantity}`; }
function actionIcon(action: string) { return action.startsWith("publish") ? "↑" : action.includes("reel") ? "▶" : "◆"; }
