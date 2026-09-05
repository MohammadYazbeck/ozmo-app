"use client";
/* eslint-disable react-hooks/set-state-in-effect -- this effect hydrates the authenticated server-backed portal */

import { FormEvent, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import styles from "./portal.module.css";

type View = "overview" | "content" | "sessions" | "billing";

type PortalUser = {
  id: number;
  email: string;
  displayName: string;
  clientId: number;
  ozmoClientId: string;
  clientName: string;
};

type PortalSummary = {
  client: { id: string; ozmoClientId: string; name: string; logoUrl?: string | null };
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

type Accounting = {
  connected: boolean;
  invoice: {
    month: string;
    currency: string;
    amountCents: number;
    paidAmountCents: number;
    balanceCents: number;
    amountDueCents: number;
    status: "paid" | "credit" | "partial" | "unpaid";
    dueDate: string;
    downloadUrl?: string;
  } | null;
};

const navigation: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "نظرة عامة", icon: "⌂" },
  { id: "content", label: "المحتوى", icon: "▦" },
  { id: "sessions", label: "جلسات التصوير", icon: "◷" },
  { id: "billing", label: "الفواتير", icon: "▤" },
];

export default function ClientPortal() {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [summary, setSummary] = useState<PortalSummary | null>(null);
  const [accounting, setAccounting] = useState<Accounting | null>(null);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const month = currentMonth();

  const loadPortal = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const meResponse = await fetch("/api/portal/auth/me", { cache: "no-store" });
      if (!meResponse.ok) {
        setUser(null);
        setSummary(null);
        setAccounting(null);
        return;
      }
      const me = (await meResponse.json()) as { user: PortalUser };
      setUser(me.user);
      const [summaryResponse, accountingResponse] = await Promise.all([
        fetch(`/api/portal/summary?month=${month}`, { cache: "no-store" }),
        fetch(`/api/portal/accounting?month=${month}`, { cache: "no-store" }),
      ]);
      if (!summaryResponse.ok) throw new Error("تعذر تحميل بيانات المحتوى حالياً");
      setSummary((await summaryResponse.json()) as PortalSummary);
      if (accountingResponse.ok) {
        setAccounting((await accountingResponse.json()) as Accounting);
      } else {
        setAccounting(null);
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

  if (loading && !user) return <PortalLoading />;
  if (!user) return <PortalLogin onLogin={loadPortal} />;

  async function logout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    setUser(null);
    setSummary(null);
    setAccounting(null);
  }

  return (
    <main className={styles.portal} dir="rtl" lang="ar">
      <aside className={styles.sidebar}>
        <OzmoBrand />
        <div className={styles.clientCard}>
          <ClientMark name={user.clientName} logoUrl={summary?.client.logoUrl} />
          <div><strong>{user.clientName}</strong><small>{user.ozmoClientId}</small></div>
        </div>
        <nav aria-label="أقسام بوابة العملاء">
          {navigation.map((item) => (
            <button
              className={view === item.id ? styles.active : ""}
              key={item.id}
              onClick={() => setView(item.id)}
              type="button"
            >
              <span>{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <button className={styles.logout} onClick={() => void logout()} type="button" aria-label="تسجيل الخروج">
          <span className={styles.logoutIcon} aria-hidden="true">↗</span>
          <span className={styles.logoutMobile}>خروج</span>
          <span className={styles.logoutLabel}>تسجيل الخروج</span>
        </button>
      </aside>

      <section className={styles.workspace}>
        {error && <div className={styles.error}>{error}</div>}
        {!summary ? (
          <PortalLoading compact />
        ) : view === "overview" ? (
          <Overview summary={summary} accounting={accounting} onNavigate={setView} />
        ) : view === "content" ? (
          <Content summary={summary} />
        ) : view === "sessions" ? (
          <Sessions summary={summary} />
        ) : (
          <Billing accounting={accounting} />
        )}
      </section>
    </main>
  );
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

function Overview({ summary, accounting, onNavigate }: { summary: PortalSummary; accounting: Accounting | null; onNavigate: (view: View) => void }) {
  const invoice = accounting?.invoice;
  return <div className={styles.page}>
    <section className={styles.welcomeCard}>
      <div className={styles.welcomeIdentity}>
        <ClientMark name={summary.client.name} logoUrl={summary.client.logoUrl} />
        <div><h2>{summary.client.name}</h2><p>كل ما أنجزه فريق OZMO لكم، بصورة واضحة ومباشرة.</p></div>
      </div>
      <span className={styles.monthChip}>{monthLabel(summary.month)}</span>
    </section>
    <PageHeading title="نظرة عامة" copy={`ملخص ${monthLabel(summary.month)} المحدث من فريق OZMO.`} />
    <section className={styles.metrics}>
      <Metric label="تم إنتاجه هذا الشهر" value={summary.content.produced} detail="ريل ومنشور جديد" tone="orange" />
      <Metric label="تم نشره هذا الشهر" value={summary.content.published} detail="محتوى منشور" tone="green" />
      <Metric label="جاهز للنشر" value={summary.content.inventory.readyReels + summary.content.inventory.readyPosts} detail={`${summary.content.inventory.readyReels} ريل · ${summary.content.inventory.readyPosts} منشور`} tone="blue" />
      <Metric label="الفاتورة الحالية" value={invoice ? formatMoney(invoice.amountDueCents, invoice.currency) : "—"} detail={accounting?.connected ? paymentLabel(invoice?.status) : "بانتظار ربط eco"} tone="dark" />
    </section>
    <section className={styles.grid}>
      <article className={styles.card}>
        <header><div><small>خط الإنتاج</small><h2>حالة المحتوى الحالية</h2></div><button onClick={() => onNavigate("content")} type="button">عرض التفاصيل</button></header>
        <div className={styles.pipeline}>
          <Pipeline label="مسودات" value={summary.content.inventory.drafts} />
          <Pipeline label="بانتظار المونتاج" value={summary.content.inventory.shotReels} />
          <Pipeline label="ريل جاهز" value={summary.content.inventory.readyReels} />
          <Pipeline label="منشور جاهز" value={summary.content.inventory.readyPosts} />
        </div>
      </article>
      <article className={styles.card}>
        <header><div><small>جلسة التصوير</small><h2>الموعد القادم</h2></div></header>
        {summary.upcomingSession ? <div className={styles.session}><span>◷</span><strong>{formatDate(summary.upcomingSession.scheduledAt, true)}</strong><p>جلسة تصوير مجدولة مع فريق OZMO</p></div> : <Empty text="لا توجد جلسة تصوير مجدولة حالياً." />}
      </article>
    </section>
    <article className={`${styles.card} ${styles.kpiCard}`}>
      <header>
        <div><small>أهداف الشهر</small><h2>مؤشرات الأداء الرئيسية</h2></div>
        <span className={styles.kpiProgress}>
          {summary.monthlyKpis.filter((goal) => goal.completed).length} / {summary.monthlyKpis.length} مكتمل
        </span>
      </header>
      {summary.monthlyKpis.length === 0 ? (
        <Empty text="لم يحدد فريق OZMO أهداف مؤشرات أداء لهذا الشهر بعد." />
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
    <PageHeading title="المحتوى" copy="حركة الإنتاج والنشر المسجلة لهذا الشهر." />
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
    <PageHeading title="جلسات التصوير" copy="مواعيد التصوير القادمة وحالة المواد المصورة." />
    <section className={styles.grid}>
      <article className={styles.card}><header><div><small>الموعد القادم</small><h2>جلسة التصوير</h2></div></header>{summary.upcomingSession ? <div className={styles.session}><span>◷</span><strong>{formatDate(summary.upcomingSession.scheduledAt, true)}</strong><p>سيتم التواصل معكم لتأكيد التفاصيل.</p></div> : <Empty text="لا توجد جلسة مجدولة حالياً." />}</article>
      <article className={styles.card}><header><div><small>المواد المصورة</small><h2>بانتظار المونتاج</h2></div></header><div className={styles.bigNumber}>{summary.content.inventory.shotReels}<small>ريل مصور</small></div></article>
    </section>
  </div>;
}

function Billing({ accounting }: { accounting: Accounting | null }) {
  const invoice = accounting?.invoice;
  return <div className={styles.page}>
    <PageHeading title="الفواتير" copy="بيانات الاشتراك والدفعات من نظام eco." />
    {!accounting?.connected || !invoice ? <article className={`${styles.card} ${styles.unavailable}`}><span>↔</span><h2>الربط المحاسبي قيد الإعداد</h2><p>ستظهر الفاتورة هنا فور تفعيل اتصال eco الآمن.</p></article> : <article className={`${styles.card} ${styles.invoice}`}><header><div><small>الفاتورة الحالية</small><h2>{monthLabel(invoice.month)}</h2></div><em>{paymentLabel(invoice.status)}</em></header><strong>{formatMoney(invoice.amountDueCents, invoice.currency)}</strong><dl><div><dt>قيمة الاشتراك</dt><dd>{formatMoney(invoice.amountCents, invoice.currency)}</dd></div><div><dt>المبلغ المدفوع</dt><dd>{formatMoney(invoice.paidAmountCents, invoice.currency)}</dd></div><div><dt>الرصيد</dt><dd>{formatMoney(invoice.balanceCents, invoice.currency)}</dd></div><div><dt>الاستحقاق</dt><dd>{formatDate(invoice.dueDate)}</dd></div></dl>{invoice.downloadUrl && <a href={invoice.downloadUrl}>تنزيل فاتورة Excel ⇩</a>}</article>}
  </div>;
}

function PageHeading({ title, copy }: { title: string; copy: string }) { return <header className={styles.pageHeading}><h1>{title}</h1><p>{copy}</p></header>; }
function Metric({ label, value, detail, tone }: { label: string; value: number | string; detail: string; tone: string }) { return <article className={`${styles.metric} ${styles[tone]}`}><small>{label}</small><strong>{value}</strong><span>{detail}</span></article>; }
function Pipeline({ label, value }: { label: string; value: number }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function Empty({ text }: { text: string }) { return <div className={styles.empty}><span>○</span><p>{text}</p></div>; }
function PortalLoading({ compact = false }: { compact?: boolean }) { return <main className={compact ? styles.compactLoading : styles.loading} dir="rtl"><OzmoBrand /><p>جارٍ تجهيز بوابتك…</p></main>; }

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
function formatMoney(cents: number, currency: string) { return new Intl.NumberFormat("ar-SY", { style: "currency", currency: currency || "USD" }).format(cents / 100); }
function paymentLabel(status?: string) { return ({ paid: "مدفوعة", credit: "رصيد دائن", partial: "مدفوعة جزئياً", unpaid: "غير مدفوعة" } as Record<string, string>)[status ?? ""] ?? "غير متاحة"; }
function actionLabel(action: string, quantity: number) { const labels: Record<string, string> = { reel_new: "إنتاج ريل جديد", post_new: "إنتاج منشور جديد", publish_reel: "نشر ريل", publish_post: "نشر منشور", draft_created: "إعداد مسودة", reel_reedit: "تعديل ريل" }; return `${labels[action] ?? "تحديث المحتوى"} · ${quantity}`; }
function actionIcon(action: string) { return action.startsWith("publish") ? "↑" : action.includes("reel") ? "▶" : "◆"; }
