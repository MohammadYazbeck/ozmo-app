"use client";
/* eslint-disable react-hooks/set-state-in-effect -- these effects hydrate server-backed records and browser capability state */

import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import {
  BrowserNotificationStatus,
  deviceSetupUrl as getDeviceSetupUrl,
  enableBrowserNotifications,
  getBrowserNotificationStatus,
  getOzmoServiceWorker,
  reconcileBrowserPushSubscription,
  showBrowserNotification,
} from "./browserNotifications";

type Role = "admin" | "editor" | "designer" | "account_manager";

type User = {
  id: string | number;
  username: string;
  displayName: string;
  phone: string;
  role: Role;
  isActive?: boolean;
  hasPassword?: boolean;
  lastLoginAt?: string | null;
  tutorialCompleted: boolean;
};

type Client = {
  id: string;
  ozmoClientId: string;
  name: string;
  shotReelCount: number;
  reelCount: number;
  postCount: number;
  draftCount: number;
  sessionThreshold: number;
  remainingPaymentCents: number;
  remainingPaymentCurrency: string;
  postThreshold?: number | null;
  draftThreshold?: number | null;
  needsSession: boolean;
  updatedAt?: string;
  logoUrl?: string | null;
};

type MonthlyKpi = {
  id: string;
  clientId: string;
  month: string;
  goal: string;
  completed: boolean;
  completedAt?: string | null;
  createdAt: string;
};

type ReportTask = {
  id?: string;
  clientId: string;
  clientName?: string;
  actionType: string;
  status: "completed" | "in_progress";
  quantity: number;
  notes: string;
  reelsShot?: number;
  sessionAt?: string;
  sessionId?: string;
  createdAt?: string;
  isCorrection?: boolean;
};

type DailyReport = {
  id?: string;
  reportDate: string;
  status: "not_started" | "draft" | "submitted";
  submittedAt?: string | null;
  isLate?: boolean;
  isLocked?: boolean;
  lockReason?: string | null;
  nextOpenAt?: string | null;
  reportDeadline?: string;
  effectiveWorkStart?: string;
  effectiveWorkEnd?: string;
  effectiveWorkDays?: number[];
  editTokensRemaining?: number;
  canCorrect?: boolean;
  tasks: ReportTask[];
};

type NotificationItem = {
  id: string;
  type: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  read: boolean;
  createdAt: string;
};

type SessionItem = {
  id: string;
  clientId: string;
  clientName: string;
  scheduledAt: string;
  status: "scheduled" | "completed" | "cancelled" | "missed";
  notes?: string;
  reelsShot?: number | null;
  createdByName?: string;
};

type MonthArchive = {
  id: string;
  month: string;
  startDate: string;
  endDate: string;
  closedAt: string;
  closedByName: string;
  notes?: string;
  taskCount: number;
  reportCount: number;
  inventory: Array<{
    clientId: string;
    clientName: string;
    contentType: "draft" | "shot_reel" | "reel" | "post";
    closingQuantity: number;
    carryQuantity: number;
    resetDelta: number;
  }>;
};

type DashboardData = {
  today: string;
  reportDeadline?: string;
  workStart?: string;
  workEnd?: string;
  workDays?: number[];
  totalStaff: number;
  submittedCount: number;
  missingCount: number;
  completionRate: number;
  shotReelsWaiting: number;
  reelsAvailable: number;
  postsAvailable: number;
  draftsAvailable: number;
  contentProducedThisMonth: number;
  contentPublishedThisMonth: number;
  reportStatuses: Array<{
    userId: string;
    displayName: string;
    role: Role;
    status: "submitted" | "draft" | "missing";
    submittedAt?: string | null;
  }>;
  offToday?: Array<{
    userId: string;
    displayName: string;
    role: Role;
  }>;
  clients: Client[];
  recentActivity: HistoryItem[];
  weeklyProduction: Array<{ label: string; produced: number; published: number }>;
  upcomingSessions: SessionItem[];
};

type AdminReport = {
  id: string;
  userId: string;
  reportDate: string;
  status: "draft" | "submitted";
  summary: string;
  submittedAt?: string | null;
  displayName: string;
  role: Exclude<Role, "admin">;
  tasks: ReportTask[];
};

type HistoryItem = {
  id: string;
  date: string;
  actorName: string;
  actorRole: Role;
  clientName?: string | null;
  actionType: string;
  notes?: string | null;
  shotReelDelta?: number;
  reelDelta?: number;
  postDelta?: number;
  draftDelta?: number;
  source?: string;
};

type SettingsData = {
  reportDeadline: string;
  firstReminder: string;
  secondReminder: string;
  escalationTime: string;
  workStart: string;
  workEnd: string;
  workDays: number[];
  sessionThreshold: number;
  sessionReminderTime: string;
  postThreshold: number | null;
  draftThreshold: number | null;
  dailySummaryTime: string;
  weeklySummaryDay: number;
  weeklySummaryTime: string;
  inventoryReady: boolean;
  staffSchedules?: StaffSchedule[];
};

type StaffSchedule = {
  userId: string | number;
  displayName: string;
  role: Role;
  workStart: string | null;
  workEnd: string | null;
  workDays: number[] | null;
  effectiveWorkStart: string;
  effectiveWorkEnd: string;
  effectiveWorkDays: number[];
};

type AppSection =
  | "home"
  | "reports"
  | "inventory"
  | "clients"
  | "sessions"
  | "archive"
  | "team"
  | "activity"
  | "settings"
  | "history"
  | "help";

type ActionOption = {
  value: string;
  label: string;
  ar: string;
  effect:
    | "shot_to_reel"
    | "shot_add"
    | "post_add"
    | "draft_add"
    | "reel_take"
    | "post_take"
    | "none";
  needsStatus?: boolean;
  needsSessionDate?: boolean;
  needsSessionSelect?: boolean;
  needsReelsShot?: boolean;
  scope?: "client" | "agency";
};

const OTHER_CLIENT_ID = "__other__";

const ACTIONS: Record<Exclude<Role, "admin">, ActionOption[]> = {
  editor: [
    {
      value: "reel_new",
      label: "New reel",
      ar: "ريل جديد",
      effect: "shot_to_reel",
      needsStatus: true,
    },
    {
      value: "reel_reedit",
      label: "Re-edit reel",
      ar: "تعديل ريل",
      effect: "none",
      needsStatus: true,
    },
    {
      value: "other",
      label: "Other editing task",
      ar: "مهمة مونتاج أخرى",
      effect: "none",
      needsStatus: true,
    },
  ],
  designer: [
    {
      value: "post_new",
      label: "New post / design",
      ar: "بوست أو تصميم جديد",
      effect: "post_add",
      needsStatus: true,
    },
    {
      value: "post_revision",
      label: "Design revision",
      ar: "تعديل تصميم",
      effect: "none",
      needsStatus: true,
    },
    {
      value: "other",
      label: "Other design task",
      ar: "مهمة تصميم أخرى",
      effect: "none",
      needsStatus: true,
    },
  ],
  account_manager: [
    {
      value: "publish_reel",
      label: "Published reel",
      ar: "نشر ريل",
      effect: "reel_take",
    },
    {
      value: "publish_post",
      label: "Published post",
      ar: "نشر بوست",
      effect: "post_take",
    },
    {
      value: "draft_created",
      label: "Created content draft",
      ar: "إنشاء مسودة محتوى",
      effect: "draft_add",
    },
    {
      value: "meeting",
      label: "Client meeting",
      ar: "اجتماع عميل",
      effect: "none",
    },
    {
      value: "session_scheduled",
      label: "Scheduled a session",
      ar: "تثبيت جلسة تصوير",
      effect: "none",
      needsSessionDate: true,
    },
    {
      value: "session_completed",
      label: "Session completed",
      ar: "تمت الجلسة",
      effect: "shot_add",
      needsSessionSelect: true,
      needsReelsShot: true,
    },
    {
      value: "session_cancelled",
      label: "Session cancelled",
      ar: "ألغيت الجلسة",
      effect: "none",
      needsSessionSelect: true,
    },
    {
      value: "session_missed",
      label: "Session missed",
      ar: "لم تتم الجلسة",
      effect: "none",
      needsSessionSelect: true,
    },
    {
      value: "competitor_analysis",
      label: "Competitor analysis",
      ar: "تحليل المنافسين",
      effect: "none",
      scope: "agency",
    },
    {
      value: "agency_report",
      label: "Agency report",
      ar: "تقرير للوكالة",
      effect: "none",
      scope: "agency",
    },
    {
      value: "agency_observation",
      label: "Agency observation",
      ar: "ملاحظة عامة للوكالة",
      effect: "none",
      scope: "agency",
    },
    {
      value: "other",
      label: "Other account task",
      ar: "مهمة إدارة حساب أخرى",
      effect: "none",
    },
  ],
};

const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  editor: "Video editor",
  designer: "Designer",
  account_manager: "Account manager",
};

const ACTION_LABELS: Record<string, string> = Object.values(ACTIONS)
  .flat()
  .reduce<Record<string, string>>((labels, action) => {
    labels[action.value] = action.label;
    return labels;
  }, {
    inventory_adjustment: "Inventory adjustment",
    report_submitted: "Daily report submitted",
    session: "Session activity",
    month_close_reset: "Month-end archive",
  });

function todayInDamascus() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Damascus",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Damascus",
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function formatClock(value?: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) return value || "—";
  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minute} ${suffix}`;
}

const WORKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatWorkDays(days?: number[]) {
  const valid = (days ?? [])
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .map((day) => WORKDAY_LABELS[day]);
  return valid.length ? valid.join(", ") : "No working days";
}

function reportLockMessage(report: DailyReport) {
  switch (report.lockReason) {
    case "loading":
      return "Checking today’s reporting schedule…";
    case "before_work_start":
      return "Daily reporting has not opened yet.";
    case "after_deadline":
      return "Today’s report deadline has passed.";
    case "day_off":
      return "Daily reporting is closed on your assigned day off.";
    case "no_working_days":
      return "No working days are currently assigned to your profile.";
    default:
      return "Reporting is closed for today. It will reopen on your next working day.";
  }
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function newTask(role: Role, firstClientId = ""): ReportTask {
  const roleActions = role === "admin" ? [] : ACTIONS[role];
  return {
    clientId: firstClientId,
    actionType: roleActions[0]?.value ?? "other",
    status: "completed",
    quantity: 1,
    notes: "",
  };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "Something went wrong. Please try again.");
  }
  return payload;
}

function Icon({
  name,
  size = 20,
}: {
  name:
    | "home"
    | "box"
    | "clients"
    | "calendar"
    | "team"
    | "activity"
    | "settings"
    | "history"
    | "help"
    | "bell"
    | "plus"
    | "check"
    | "logout"
    | "arrow"
    | "spark"
    | "menu"
    | "close"
    | "lock"
    | "edit"
    | "eye"
    | "refresh"
    | "download"
    | "send";
  size?: number;
}) {
  const paths: Record<string, ReactNode> = {
    home: (
      <>
        <path d="M3 10.8 12 3l9 7.8" />
        <path d="M5.5 9.8V21h13V9.8M9 21v-7h6v7" />
      </>
    ),
    box: (
      <>
        <path d="m4 7 8-4 8 4-8 4-8-4Z" />
        <path d="M4 7v10l8 4 8-4V7M12 11v10" />
      </>
    ),
    clients: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M7 9h10M7 13h6M7 17h4" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
      </>
    ),
    team: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    activity: (
      <>
        <path d="M3 12h4l2.2-7 4.1 14 2.2-7H21" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.15.38.38.72.7 1 .3.25.7.4 1.1.4h.1v4h-.1c-.4 0-.8.15-1.1.4-.32.28-.55.62-.7 1Z" />
      </>
    ),
    history: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5M12 7v5l3 2" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.7 9a2.5 2.5 0 1 1 4.2 1.8c-1 .8-1.9 1.2-1.9 2.7M12 17h.01" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    check: <path d="m5 12 4 4L19 6" />,
    logout: (
      <>
        <path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-6" />
      </>
    ),
    arrow: <path d="m9 18 6-6-6-6" />,
    spark: (
      <>
        <path d="m12 3 1.2 4.1L17 9l-3.8 1.9L12 15l-1.2-4.1L7 9l3.8-1.9L12 3Z" />
        <path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15ZM5 3l.6 2L8 6l-2.4 1L5 9l-.6-2L2 6l2.4-1L5 3Z" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    lock: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    edit: (
      <>
        <path d="m14 4 6 6M3 21l3.5-1 13-13a2.1 2.1 0 0 0-3-3l-13 13L3 21Z" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 11a8 8 0 1 0-2.34 5.66" />
        <path d="M20 4v7h-7" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    send: (
      <>
        <path d="m22 2-7 20-4-9-9-4 20-7Z" />
        <path d="M22 2 11 13" />
      </>
    ),
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`brand ${compact ? "brand-compact" : ""}`}
      aria-label="OZMO"
      role="img"
    >
      <span className="brand-mark" aria-hidden="true" />
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="loading-logo">
        <span className="brand-mark" />
      </div>
      <div className="loading-line">
        <span />
      </div>
      <p>Preparing your workspace…</p>
    </main>
  );
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="story-glow story-glow-one" />
        <div className="story-glow story-glow-two" />
        <Brand />
        <div className="story-copy">
          <span className="eyebrow light">
            <Icon name="spark" size={16} /> One calm place for your content
          </span>
          <h1>Every task. Every client. Always in rhythm.</h1>
          <p>
            OZMO keeps production, publishing, inventory and sessions visible to
            the right people—without the spreadsheet noise.
          </p>
        </div>
        <div className="story-proof">
          <div className="proof-stack">
            <span>O</span>
            <span>Z</span>
            <span>M</span>
            <span>+6</span>
          </div>
          <p>
            <strong>Built for the OZMO team</strong>
            Securely available inside your office.
          </p>
        </div>
      </section>
      <section className="auth-form-side">{children}</section>
    </main>
  );
}

function SetupScreen({ onReady }: { onReady: () => Promise<void> }) {
  const [username, setUsername] = useState("mwafak");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 10) {
      setError("Use at least 10 characters for the administrator password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/setup", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      await onReady();
    } catch (setupError) {
      setError((setupError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div className="auth-card">
        <span className="auth-step">Secure first-time setup</span>
        <h2>Welcome to OZMO</h2>
        <p className="muted">
          Choose the first administrator and create the private password that
          opens the control center.
        </p>
        <form onSubmit={submit} className="auth-form">
          <label>
            First administrator
            <select value={username} onChange={(event) => setUsername(event.target.value)}>
              <option value="mwafak">Mwafak</option>
              <option value="ghaith">Ghaith</option>
              <option value="yaz">Yaz</option>
            </select>
          </label>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 10 characters"
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repeat the password"
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="button button-primary button-wide" disabled={busy}>
            {busy ? "Securing workspace…" : "Create secure workspace"}
            {!busy && <Icon name="arrow" size={18} />}
          </button>
        </form>
        <div className="security-note">
          <Icon name="lock" size={18} />
          <span>
            Passwords are encrypted. Other employee passwords are created later
            by an administrator from the Team page.
          </span>
        </div>
      </div>
    </AuthShell>
  );
}

function LoginScreen({ onLogin }: { onLogin: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      await onLogin();
    } catch (loginError) {
      setError((loginError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div className="auth-card">
        <span className="auth-step">Private office workspace</span>
        <h2>Good to see you</h2>
        <p className="muted">
          Sign in with the username and password provided by your manager.
        </p>
        <form onSubmit={submit} className="auth-form">
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              placeholder="Your OZMO username"
              autoFocus
            />
          </label>
          <label>
            Password
            <span className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="Your password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <Icon name="eye" size={18} />
              </button>
            </span>
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="button button-primary button-wide" disabled={busy}>
            {busy ? "Signing in…" : "Enter workspace"}
            {!busy && <Icon name="arrow" size={18} />}
          </button>
        </form>
        <div className="security-note">
          <Icon name="lock" size={18} />
          <span>
            This system is private and intended only for use on the OZMO office
            network.
          </span>
        </div>
      </div>
    </AuthShell>
  );
}

function Tutorial({
  user,
  report,
  onComplete,
  onClose,
}: {
  user: User;
  report: DailyReport;
  onComplete: () => Promise<void>;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const isEditor = user.role === "editor";
  const isDesigner = user.role === "designer";
  const deadline = formatClock(report.reportDeadline ?? "18:00");
  const workingDays = formatWorkDays(
    report.effectiveWorkDays ?? [6, 0, 1, 2, 3],
  );
  const steps = [
    {
      eyebrow: `Welcome, ${user.displayName}`,
      title: "Your daily report takes less than a minute.",
      body: `Add what you completed, choose the correct client, then submit before ${deadline}. Your own history stays available here.`,
      visual: (
        <div className="tutorial-preview welcome-preview">
          <span className="brand-mark" />
          <div>
            <small>Today · 26 July</small>
            <strong>Ready when you are.</strong>
          </div>
        </div>
      ),
    },
    {
      eyebrow: "Step 1 · Add your work",
      title: "Choose the client and the real action.",
      body: isEditor
        ? "A New reel adds to inventory only when completed. A Re-edit is recorded in your history but never adds another reel."
        : isDesigner
          ? "A New post adds to inventory only when completed. Revisions and work still in progress stay in your history without changing inventory."
          : "Publishing consumes the chosen client’s inventory. Drafts add a reference draft. Meetings and session scheduling never add finished content.",
      visual: (
        <div className="tutorial-preview form-preview">
          <span>MAGIC</span>
          <strong>
            {isEditor
              ? "New reel"
              : isDesigner
                ? "New post / design"
                : "Published reel"}
          </strong>
          <em>{isEditor || isDesigner ? "+1 when complete" : "−1 reel"}</em>
        </div>
      ),
    },
    {
      eyebrow: "Step 2 · Submit on time",
      title: "Reminders stop the moment you submit.",
      body: `Your working days are ${workingDays}. You receive two reminders only while your report is missing, and managers are alerted after the ${deadline} deadline.`,
      visual: (
        <div className="tutorial-preview reminder-preview">
          <span>1st reminder</span>
          <i />
          <span>2nd reminder</span>
          <i />
          <strong>{deadline}</strong>
        </div>
      ),
    },
    {
      eyebrow: "Step 3 · Stay notified",
      title: "Connect notifications from Settings on each device.",
      body: "After the tour, open Notifications and tap Enable. Phones need the trusted HTTPS office link; on iPhone, add OZMO to the Home Screen first.",
      visual: (
        <div className="tutorial-preview notification-preview">
          <Icon name="bell" size={25} />
          <div>
            <strong>Daily report reminder</strong>
            <span>تذكير بالتقرير اليومي</span>
          </div>
        </div>
      ),
    },
  ];

  async function finish() {
    setBusy(true);
    try {
      await onComplete();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const current = steps[step];
  return (
    <div className="modal-backdrop tutorial-backdrop" role="dialog" aria-modal="true">
      <div className="tutorial-card">
        <button className="modal-close" onClick={onClose} aria-label="Close tutorial">
          <Icon name="close" />
        </button>
        <div className="tutorial-content">
          <span className="eyebrow">{current.eyebrow}</span>
          <h2>{current.title}</h2>
          <p>{current.body}</p>
          {current.visual}
        </div>
        <div className="tutorial-footer">
          <div className="tutorial-dots" aria-label={`Step ${step + 1} of ${steps.length}`}>
            {steps.map((_, index) => (
              <span key={index} className={index === step ? "active" : ""} />
            ))}
          </div>
          <div className="tutorial-actions">
            {step > 0 && (
              <button className="button button-ghost" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            {step < steps.length - 1 ? (
              <button className="button button-primary" onClick={() => setStep(step + 1)}>
                Continue <Icon name="arrow" size={17} />
              </button>
            ) : (
              <button className="button button-primary" onClick={finish} disabled={busy}>
                {busy ? "Finishing…" : "Start using OZMO"} <Icon name="check" size={17} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NotificationCenter({
  open,
  notifications,
  onClose,
  onReadAll,
}: {
  open: boolean;
  notifications: NotificationItem[];
  onClose: () => void;
  onReadAll: () => Promise<void>;
}) {
  if (!open) return null;
  return (
    <>
      <button className="notification-scrim" onClick={onClose} aria-label="Close notifications" />
      <aside className="notification-panel">
        <header>
          <div>
            <span className="eyebrow">Notification center</span>
            <h3>Updates & reminders</h3>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close notifications"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="notification-list">
          {notifications.length === 0 ? (
            <div className="empty-state compact">
              <span className="empty-icon">
                <Icon name="bell" />
              </span>
              <strong>You’re all caught up</strong>
              <p>New reminders and inventory alerts will appear here.</p>
            </div>
          ) : (
            notifications.map((item) => (
              <article key={item.id} className={`notification-item ${item.read ? "" : "unread"}`}>
                <span className={`notification-type type-${item.type}`}>
                  <Icon name="bell" size={16} />
                </span>
                <div>
                  <div className="notification-meta">
                    <strong>{item.titleEn}</strong>
                    <time>{formatDate(item.createdAt, true)}</time>
                  </div>
                  <p>{item.bodyEn}</p>
                  <div className="arabic-copy" dir="rtl">
                    <strong>{item.titleAr}</strong>
                    <span>{item.bodyAr}</span>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
        {notifications.some((item) => !item.read) && (
          <footer>
            <button className="button button-soft button-wide" onClick={onReadAll}>
              <Icon name="check" size={17} /> Mark all as read
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}

function StaffReport({
  user,
  clients,
  sessions,
  report,
  onRefresh,
}: {
  user: User;
  clients: Client[];
  sessions: SessionItem[];
  report: DailyReport;
  onRefresh: () => Promise<void>;
}) {
  const [tasks, setTasks] = useState<ReportTask[]>(
    report.tasks.length ? report.tasks : [newTask(user.role, clients[0]?.id)],
  );
  const syncedReportDate = useRef(report.reportDate);
  const [dirty, setDirty] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [busy, setBusy] = useState<"save" | "submit" | "correct" | null>(
    null,
  );
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [correctionMode, setCorrectionMode] = useState(false);
  const submitted = report.status === "submitted";
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Damascus",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(clock);
  const damascusHour = Number(
    timeParts.find((part) => part.type === "hour")?.value ?? 0,
  );
  const damascusMinute = Number(
    timeParts.find((part) => part.type === "minute")?.value ?? 0,
  );
  const damascusWeekday = WORKDAY_LABELS.indexOf(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Damascus",
      weekday: "short",
    }).format(clock),
  );
  const currentMinutes = damascusHour * 60 + damascusMinute;
  const [startHour, startMinute] = (report.effectiveWorkStart ?? "10:00")
    .split(":")
    .map(Number);
  const [deadlineHour, deadlineMinute] = (
    report.reportDeadline ?? "18:00"
  )
    .split(":")
    .map(Number);
  const workDays = report.effectiveWorkDays ?? [6, 0, 1, 2, 3];
  const localLockReason =
    workDays.length === 0
      ? "no_working_days"
      : !workDays.includes(damascusWeekday)
        ? "day_off"
        : currentMinutes < startHour * 60 + startMinute
          ? "before_work_start"
          : currentMinutes >= deadlineHour * 60 + deadlineMinute
            ? "after_deadline"
            : null;
  const locked = correctionMode
    ? localLockReason !== null
    : !submitted && (report.isLocked === true || localLockReason !== null);
  const visibleReportLock: DailyReport = {
    ...report,
    lockReason:
      report.isLocked === true ? report.lockReason : localLockReason,
  };
  const readOnly = (submitted && !correctionMode) || locked;
  const roleActions = user.role === "admin" ? [] : ACTIONS[user.role];

  useEffect(() => {
    const dayChanged = syncedReportDate.current !== report.reportDate;
    if (dirty && !dayChanged) return;
    syncedReportDate.current = report.reportDate;
    if (dayChanged) setDirty(false);
    if (dayChanged) setCorrectionMode(false);
    setTasks(report.tasks.length ? report.tasks : [newTask(user.role, clients[0]?.id)]);
  }, [report, user.role, clients, dirty]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function changeTask(index: number, patch: Partial<ReportTask>) {
    setDirty(true);
    setTasks((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }

  function removeTask(index: number) {
    setDirty(true);
    setTasks((items) => items.filter((_, itemIndex) => itemIndex !== index));
  }

  async function persist(action: "save" | "submit" | "correct") {
    setError("");
    setSuccess("");
    if (locked) {
      setError(reportLockMessage(report));
      return;
    }
    if (tasks.length === 0) {
      setError("Add at least one task before saving your report.");
      return;
    }
    if (
      tasks.some((task) => {
        const taskAction = roleActions.find(
          (option) => option.value === task.actionType,
        );
        return (
          !task.actionType ||
          (taskAction?.scope !== "agency" && !task.clientId)
        );
      })
    ) {
      setError("Choose a client for every client-related task.");
      return;
    }
    if (
      tasks.some(
        (task) =>
          task.clientId === OTHER_CLIENT_ID && !task.notes.trim(),
      )
    ) {
      setError("Describe what you completed for every task marked Other.");
      return;
    }
    const shotReelShortage = action === "save" ? undefined : clients.find((client) => {
      const required = tasks.reduce((total, task) => {
        const taskAction = roleActions.find(
          (option) => option.value === task.actionType,
        );
        return task.clientId === client.id &&
          task.status === "completed" &&
          taskAction?.effect === "shot_to_reel"
          ? total + task.quantity
          : total;
      }, 0);
      return required > client.shotReelCount;
    });
    if (shotReelShortage) {
      const required = tasks.reduce((total, task) => {
        const taskAction = roleActions.find(
          (option) => option.value === task.actionType,
        );
        return task.clientId === shotReelShortage.id &&
          task.status === "completed" &&
          taskAction?.effect === "shot_to_reel"
          ? total + task.quantity
          : total;
      }, 0);
      setError(
        `${shotReelShortage.name} has ${shotReelShortage.shotReelCount} Shot reel${shotReelShortage.shotReelCount === 1 ? "" : "s"} waiting, but this report completes ${required}. Record the session output first or correct the quantity.`,
      );
      return;
    }
    const scheduledWithoutDate = tasks.find(
      (task) => task.actionType === "session_scheduled" && !task.sessionAt,
    );
    if (scheduledWithoutDate) {
      setError("Choose the date and time for every scheduled session.");
      return;
    }
    const completedWithoutCount = tasks.find(
      (task) =>
        task.actionType === "session_completed" &&
        (!Number.isSafeInteger(task.reelsShot) ||
          Number(task.reelsShot) < 0),
    );
    if (completedWithoutCount) {
      setError("Enter how many reels were shot in every completed session.");
      return;
    }
    setBusy(action);
    try {
      await api("/api/reports", {
        method: "POST",
        body: JSON.stringify({ action, tasks }),
      });
      setDirty(false);
      setCorrectionMode(false);
      setSuccess(
        action === "submit"
          ? "Daily report submitted. Reminders are now stopped."
          : action === "correct"
            ? "The missing work was added. Your correction token is now used."
            : "Draft saved.",
      );
      await onRefresh();
    } catch (persistError) {
      setError((persistError as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const minutesLeft = Math.max(
    0,
    deadlineHour * 60 +
      deadlineMinute -
      (damascusHour * 60 + damascusMinute),
  );

  return (
    <div className="page-stack">
      <section
        className={`report-hero ${submitted ? "is-submitted" : ""} ${
          locked ? "is-locked" : ""
        }`}
      >
        <div>
          <span className="eyebrow">
            {submitted || locked ? (
              <Icon name={submitted ? "check" : "lock"} size={15} />
            ) : (
              <span className="live-dot" />
            )}
            {submitted
              ? correctionMode
                ? "One-time report correction"
                : "Report submitted"
              : locked
                ? "Reporting closed"
                : "Today’s report"}
          </span>
          <h1>
            {submitted
              ? correctionMode
                ? "Add the work you forgot."
                : "You’re done for today."
              : locked
                ? "Today’s report window is closed."
              : `What did you accomplish, ${user.displayName}?`}
          </h1>
          <p>
            {submitted
              ? correctionMode
                ? "Only add the missing work. Your original submitted tasks stay safely recorded."
                : `Submitted ${formatDate(report.submittedAt, true)}${report.isLate ? " · marked late" : ""}.`
              : locked
                ? reportLockMessage(visibleReportLock)
              : "Add each completed task clearly. You can save a draft and return before the deadline."}
          </p>
        </div>
        <div className="deadline-card">
          <small>Report deadline</small>
          <strong>{formatClock(report.reportDeadline ?? "18:00")}</strong>
          <span>
            {submitted
              ? correctionMode
                ? "1 token will be used"
                : report.editTokensRemaining
                  ? "1 correction token available"
                  : "Reminders stopped"
              : locked
                ? report.nextOpenAt
                  ? `Reopens ${formatDate(report.nextOpenAt, true)}`
                  : "Reopens next working day"
              : minutesLeft > 0
                ? `${Math.floor(minutesLeft / 60)}h ${minutesLeft % 60}m remaining`
                : "Deadline has passed"}
          </span>
        </div>
      </section>

      {submitted && !correctionMode && report.canCorrect && (
        <section className="correction-token-card">
          <div className="correction-token-icon">
            <Icon name="spark" size={21} />
          </div>
          <div>
            <span className="eyebrow">1 correction token available</span>
            <h2>Forgot something in your report?</h2>
            <p>
              You can add missing work once before the deadline. Your original
              report and inventory changes will stay untouched.
            </p>
          </div>
          <button
            className="button button-primary"
            onClick={() => {
              setError("");
              setSuccess("");
              setCorrectionMode(true);
              setDirty(true);
              setTasks([newTask(user.role, clients[0]?.id)]);
            }}
          >
            Use correction token
          </button>
        </section>
      )}

      <section className="content-card">
        <header className="section-header">
          <div>
            <span className="eyebrow">
              {correctionMode ? "Missing work addendum" : "Daily tracker"} ·{" "}
              {formatDate(report.reportDate)}
            </span>
            <h2>{correctionMode ? "Add only what was forgotten" : "Your work today"}</h2>
          </div>
          {!readOnly && (
            <button
              className="button button-soft"
              onClick={() => {
                setDirty(true);
                setTasks((items) => [
                  ...items,
                  newTask(user.role, clients[0]?.id),
                ]);
              }}
            >
              <Icon name="plus" size={17} /> Add task
            </button>
          )}
        </header>

        <div className="task-list">
          {tasks.map((task, index) => {
            const action = roleActions.find((option) => option.value === task.actionType);
            const client = clients.find((item) => item.id === task.clientId);
            const available =
              action?.effect === "shot_to_reel"
                ? client?.shotReelCount
                : action?.effect === "reel_take"
                  ? client?.reelCount
                  : action?.effect === "post_take"
                    ? client?.postCount
                    : undefined;
            return (
              <article key={task.id ?? index} className="task-editor">
                <div className="task-number">{index + 1}</div>
                <div className="task-fields">
                  <div className="field-grid">
                    <label>
                      {action?.scope === "agency" ? "Work scope" : "Client"}
                      <select
                        value={task.clientId}
                        onChange={(event) => {
                          const nextClientId = event.target.value;
                          changeTask(
                            index,
                            nextClientId === OTHER_CLIENT_ID
                              ? {
                                  clientId: OTHER_CLIENT_ID,
                                  actionType: "other",
                                  status: "completed",
                                  quantity: 1,
                                  sessionAt: undefined,
                                  sessionId: undefined,
                                  reelsShot: undefined,
                                }
                              : { clientId: nextClientId },
                          );
                        }}
                        disabled={readOnly || action?.scope === "agency"}
                      >
                        <option value="">
                          {action?.scope === "agency"
                            ? "OZMO · Agency-wide"
                            : "Choose client"}
                        </option>
                        {task.clientId &&
                          task.clientId !== OTHER_CLIENT_ID &&
                          task.clientName &&
                          !clients.some((item) => item.id === task.clientId) && (
                            <option value={task.clientId}>
                              {task.clientName} · Removed
                            </option>
                          )}
                        {clients.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.name}
                          </option>
                        ))}
                        <option value={OTHER_CLIENT_ID}>
                          Other / Non-client work · أخرى
                        </option>
                      </select>
                    </label>
                    <label>
                      Action
                      <select
                        value={task.actionType}
                        onChange={(event) =>
                          {
                            const nextAction = roleActions.find(
                              (option) => option.value === event.target.value,
                            );
                            changeTask(index, {
                              actionType: event.target.value,
                              clientId:
                                nextAction?.scope === "agency"
                                  ? ""
                                  : task.clientId === OTHER_CLIENT_ID &&
                                      event.target.value !== "other"
                                    ? clients[0]?.id || ""
                                    : task.clientId || clients[0]?.id || "",
                              sessionAt: undefined,
                              sessionId: undefined,
                              reelsShot: undefined,
                            });
                          }
                        }
                        disabled={readOnly}
                      >
                        {roleActions.map((option) => (
                          <option value={option.value} key={option.value}>
                            {option.label} · {option.ar}
                          </option>
                        ))}
                      </select>
                    </label>
                    {action?.needsStatus && (
                      <label>
                        Progress
                        <select
                          value={task.status}
                          onChange={(event) =>
                            changeTask(index, {
                              status: event.target.value as ReportTask["status"],
                            })
                          }
                          disabled={readOnly}
                        >
                          <option value="completed">Completed</option>
                          <option value="in_progress">Still in progress</option>
                        </select>
                      </label>
                    )}
                    {!action?.needsReelsShot && (
                      <label>
                        Quantity
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={task.quantity}
                          onChange={(event) =>
                            changeTask(index, {
                              quantity: Math.max(1, Number(event.target.value) || 1),
                            })
                          }
                          disabled={readOnly || action?.effect === "none"}
                        />
                      </label>
                    )}
                  </div>

                  {action?.needsSessionDate && (
                    <label>
                      Session date and time
                      <input
                        type="datetime-local"
                        value={task.sessionAt ?? ""}
                        onChange={(event) => changeTask(index, { sessionAt: event.target.value })}
                        disabled={readOnly}
                      />
                    </label>
                  )}

                  {action?.needsSessionSelect && (
                    <label>
                      Scheduled session
                      <select
                        value={task.sessionId ?? ""}
                        onChange={(event) => {
                          const selectedSession = sessions.find(
                            (item) => item.id === event.target.value,
                          );
                          changeTask(index, {
                            sessionId: event.target.value,
                            clientId: selectedSession?.clientId ?? task.clientId,
                          });
                        }}
                        disabled={readOnly}
                      >
                        <option value="">Choose scheduled session</option>
                        {sessions
                          .filter((item) => item.status === "scheduled")
                          .map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.clientName} · {formatDate(item.scheduledAt, true)}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}

                  {action?.needsReelsShot && (
                    <label>
                      Reels shot in this session
                      <input
                        type="number"
                        min={0}
                        max={500}
                        inputMode="numeric"
                        value={task.reelsShot ?? ""}
                        onChange={(event) =>
                          changeTask(index, {
                            reelsShot:
                              event.target.value === ""
                                ? undefined
                                : Number(event.target.value),
                          })
                        }
                        placeholder="Enter 0 if no usable reels were shot"
                        disabled={readOnly}
                      />
                    </label>
                  )}

                  <label>
                    {task.clientId === OTHER_CLIENT_ID ? (
                      <>What did you do? / ماذا أنجزت؟</>
                    ) : (
                      <>
                        Details <span className="optional-label">Optional</span>
                      </>
                    )}
                    <textarea
                      value={task.notes}
                      onChange={(event) => changeTask(index, { notes: event.target.value })}
                      placeholder={
                        task.clientId === OTHER_CLIENT_ID
                          ? "Describe the non-client work… / اشرح العمل غير المرتبط بعميل"
                          : "Add context if useful… / أضف التفاصيل عند الحاجة"
                      }
                      rows={2}
                      required={task.clientId === OTHER_CLIENT_ID}
                      disabled={readOnly}
                    />
                  </label>
                  <div className="task-foot">
                    <InventoryEffect action={action} task={task} available={available} />
                    {!readOnly && tasks.length > 1 && (
                      <button className="text-button danger" onClick={() => removeTask(index)}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {error && <div className="form-error">{error}</div>}
        {success && <div className="form-success">{success}</div>}

        {!readOnly && (
          <footer className="report-actions">
            {correctionMode ? (
              <>
                <button
                  className="button button-ghost"
                  onClick={() => {
                    setCorrectionMode(false);
                    setDirty(false);
                    setTasks(report.tasks);
                    setError("");
                  }}
                  disabled={busy !== null}
                >
                  Cancel correction
                </button>
                <button
                  className="button button-primary"
                  onClick={() => persist("correct")}
                  disabled={busy !== null}
                >
                  {busy === "correct"
                    ? "Adding missing work…"
                    : "Submit correction · use 1 token"}
                  {busy !== "correct" && <Icon name="check" size={17} />}
                </button>
              </>
            ) : (
              <>
                <button
                  className="button button-ghost"
                  onClick={() => persist("save")}
                  disabled={busy !== null}
                >
                  {busy === "save" ? "Saving…" : "Save draft"}
                </button>
                <button
                  className="button button-primary"
                  onClick={() => persist("submit")}
                  disabled={busy !== null}
                >
                  {busy === "submit" ? "Submitting…" : "Submit today’s report"}
                  {busy !== "submit" && <Icon name="check" size={17} />}
                </button>
              </>
            )}
          </footer>
        )}
      </section>

      <section className="rule-strip">
        <Icon name="spark" size={19} />
        <div>
          <strong>Your inventory rule</strong>
          <p>
            {user.role === "editor"
              ? "A completed New reel converts one Shot reel into one Finished reel. Re-edits and in-progress work do not change inventory."
              : user.role === "designer"
                ? "Completed New posts add inventory. Revisions and in-progress work do not."
                : "A completed session adds its usable output to Shot reels. Publishing consumes finished Reel or Post inventory, and drafts add draft inventory."}
          </p>
        </div>
      </section>
    </div>
  );
}

function InventoryEffect({
  action,
  task,
  available,
}: {
  action?: ActionOption;
  task: ReportTask;
  available?: number;
}) {
  if (!action) return null;
  if (task.clientId === OTHER_CLIENT_ID) {
    return (
      <span className="effect-chip effect-neutral">
        Logged only · no inventory change
      </span>
    );
  }
  let label = "No inventory change";
  let tone = "neutral";
  if (action.effect === "shot_to_reel") {
    label =
      task.status === "completed"
        ? `−${task.quantity} Shot reel${task.quantity === 1 ? "" : "s"} → +${task.quantity} Finished reel${task.quantity === 1 ? "" : "s"} · ${available ?? 0} waiting`
        : "No inventory change until completed";
    tone =
      task.status === "completed"
        ? (available ?? 0) < task.quantity
          ? "danger"
          : "positive"
        : "neutral";
  }
  if (action.effect === "shot_add") {
    const output = task.reelsShot;
    label =
      output == null
        ? "Enter the usable reels shot"
        : `+${output} Shot reel${output === 1 ? "" : "s"} to edit`;
    tone = output != null && output > 0 ? "positive" : "neutral";
  }
  if (action.effect === "post_add") {
    label =
      task.status === "completed"
        ? `+${task.quantity} Post${task.quantity === 1 ? "" : "s"}`
        : "Adds 0 until completed";
    tone = task.status === "completed" ? "positive" : "neutral";
  }
  if (action.effect === "draft_add") {
    label = `+${task.quantity} Draft${task.quantity === 1 ? "" : "s"}`;
    tone = "positive";
  }
  if (action.effect === "reel_take") {
    label = `−${task.quantity} Reel · ${available ?? 0} available`;
    tone = (available ?? 0) < task.quantity ? "danger" : "negative";
  }
  if (action.effect === "post_take") {
    label = `−${task.quantity} Post · ${available ?? 0} available`;
    tone = (available ?? 0) < task.quantity ? "danger" : "negative";
  }
  return <span className={`effect-chip effect-${tone}`}>{label}</span>;
}

function MetricCard({
  label,
  value,
  detail,
  tone,
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: "orange" | "green" | "blue" | "purple";
  icon: "check" | "box" | "spark" | "activity";
}) {
  return (
    <article className="metric-card">
      <span className={`metric-icon metric-${tone}`}>
        <Icon name={icon} size={20} />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function AdminDashboard({
  data,
  onNavigate,
}: {
  data: DashboardData;
  onNavigate: (section: AppSection) => void;
}) {
  const maxChart = Math.max(
    1,
    ...data.weeklyProduction.flatMap((item) => [item.produced, item.published]),
  );
  const sessionClients = data.clients.filter((client) => client.needsSession);
  const lowInventory = data.clients
    .filter(
      (client) =>
        client.needsSession ||
        (client.postThreshold != null && client.postCount <= client.postThreshold) ||
        (client.draftThreshold != null && client.draftCount <= client.draftThreshold),
    )
    .slice(0, 7);

  return (
    <div className="page-stack">
      <section className="dashboard-welcome">
        <div>
          <span className="eyebrow">
            <span className="live-dot" /> Live office overview
          </span>
          <h1>Your content operation, at a glance.</h1>
          <p>
            {data.submittedCount} of {data.totalStaff} scheduled staff reports are in for today.
            {data.missingCount > 0
              ? ` ${data.missingCount} still need attention before ${formatClock(data.reportDeadline ?? "18:00")}.`
              : " Everyone scheduled today is on track."}
            {data.offToday?.length
              ? ` ${data.offToday.length} team member${data.offToday.length === 1 ? " is" : "s are"} off today.`
              : ""}
          </p>
        </div>
        <button className="button button-primary" onClick={() => onNavigate("inventory")}>
          <Icon name="edit" size={17} /> Adjust inventory
        </button>
      </section>

      <section className="metric-grid">
        <MetricCard
          label="Reports submitted"
          value={`${data.submittedCount}/${data.totalStaff}`}
          detail={`${data.completionRate}% complete today`}
          tone="green"
          icon="check"
        />
        <MetricCard
          label="Content pipeline"
          value={
            data.draftsAvailable +
            data.shotReelsWaiting +
            data.reelsAvailable +
            data.postsAvailable
          }
          detail={`${data.draftsAvailable} drafts · ${data.shotReelsWaiting} shot · ${data.reelsAvailable} finished reels · ${data.postsAvailable} posts`}
          tone="orange"
          icon="box"
        />
        <MetricCard
          label="Produced this month"
          value={data.contentProducedThisMonth}
          detail="New reels, posts & drafts"
          tone="blue"
          icon="spark"
        />
        <MetricCard
          label="Clients need sessions"
          value={sessionClients.length}
          detail={
            sessionClients.length
              ? "Finished + shot reel coverage is low"
              : "Healthy reel pipeline coverage"
          }
          tone="purple"
          icon="activity"
        />
      </section>

      <section className="dashboard-grid">
        <article className="content-card submission-card">
          <header className="section-header">
            <div>
              <span className="eyebrow">Daily reports</span>
              <h2>Team check-in</h2>
            </div>
            <span className="completion-pill">{data.completionRate}%</span>
          </header>
          <div className="progress-track">
            <span style={{ width: `${data.completionRate}%` }} />
          </div>
          <div className="team-status-list">
            {data.reportStatuses.map((item) => (
              <div className="team-status-row" key={item.userId}>
                <span className={`avatar avatar-${item.role}`}>{initials(item.displayName)}</span>
                <div>
                  <strong>{item.displayName}</strong>
                  <small>{ROLE_LABELS[item.role]}</small>
                </div>
                <span className={`status-chip status-${item.status}`}>
                  {item.status === "submitted"
                    ? `Submitted ${item.submittedAt ? formatDate(item.submittedAt, true).split(",").pop() : ""}`
                    : item.status === "draft"
                      ? "Draft saved"
                      : "Missing"}
                </span>
              </div>
            ))}
            {data.offToday?.map((item) => (
              <div className="team-status-row" key={`off-${item.userId}`}>
                <span className={`avatar avatar-${item.role}`}>
                  {initials(item.displayName)}
                </span>
                <div>
                  <strong>{item.displayName}</strong>
                  <small>{ROLE_LABELS[item.role]}</small>
                </div>
                <span className="status-chip status-off">Off today</span>
              </div>
            ))}
          </div>
        </article>

        <article className="content-card chart-card">
          <header className="section-header">
            <div>
              <span className="eyebrow">Last 7 days</span>
              <h2>Production rhythm</h2>
            </div>
            <div className="chart-legend">
              <span><i className="legend-produced" /> Produced</span>
              <span><i className="legend-published" /> Published</span>
            </div>
          </header>
          <div className="bar-chart">
            {data.weeklyProduction.map((item) => (
              <div className="bar-group" key={item.label}>
                <div className="bars">
                  <span
                    className="bar produced"
                    style={{ height: `${Math.max(5, (item.produced / maxChart) * 100)}%` }}
                    title={`${item.produced} produced`}
                  />
                  <span
                    className="bar published"
                    style={{ height: `${Math.max(5, (item.published / maxChart) * 100)}%` }}
                    title={`${item.published} published`}
                  />
                </div>
                <small>{item.label}</small>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="dashboard-grid dashboard-grid-lower">
        <article className="content-card">
          <header className="section-header">
            <div>
              <span className="eyebrow">Inventory watch</span>
              <h2>Needs attention</h2>
            </div>
            <button className="text-button" onClick={() => onNavigate("inventory")}>
              View all <Icon name="arrow" size={15} />
            </button>
          </header>
          {lowInventory.length ? (
            <div className="inventory-watch-list">
              {lowInventory.map((client) => (
                <div className="inventory-watch-row" key={client.id}>
                  <span className="client-monogram">{client.name.slice(0, 2)}</span>
                  <strong>{client.name}</strong>
                  <span className={client.needsSession ? "count-warning" : ""}>
                    {client.shotReelCount} <small>Shot</small>
                    <br />
                    {client.reelCount} <small>Ready</small>
                  </span>
                  <span>
                    {client.postCount} <small>Posts</small>
                  </span>
                  <span>
                    {client.draftCount} <small>Drafts</small>
                  </span>
                  {client.needsSession && <em>Session needed</em>}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <span className="empty-icon success">
                <Icon name="check" />
              </span>
              <strong>Inventory is healthy</strong>
              <p>No configured threshold needs attention.</p>
            </div>
          )}
        </article>

        <article className="content-card">
          <header className="section-header">
            <div>
              <span className="eyebrow">Latest activity</span>
              <h2>What just happened</h2>
            </div>
            <button className="text-button" onClick={() => onNavigate("activity")}>
              Full log <Icon name="arrow" size={15} />
            </button>
          </header>
          <ActivityList items={data.recentActivity.slice(0, 6)} />
        </article>
      </section>
    </div>
  );
}

function AdminReportsPage({ clients }: { clients: Client[] }) {
  const [date, setDate] = useState(todayInDamascus());
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [tasks, setTasks] = useState<ReportTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selected = reports.find((report) => report.id === selectedId);

  const loadReports = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ reports: AdminReport[] }>(`/api/admin/reports?date=${encodeURIComponent(date)}`);
      setReports(result.reports);
      const next = result.reports.find((report) => report.id === selectedId) ?? result.reports[0];
      setSelectedId(next?.id ?? "");
      setTasks(next?.tasks ?? []);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setBusy(false);
    }
  }, [date, selectedId]);

  useEffect(() => { void loadReports(); }, [loadReports]);
  useEffect(() => {
    const next = reports.find((report) => report.id === selectedId);
    setTasks(next?.tasks ?? []);
  }, [reports, selectedId]);

  function changeTask(index: number, patch: Partial<ReportTask>) {
    setTasks((current) => current.map((task, taskIndex) => taskIndex === index ? { ...task, ...patch } : task));
  }

  async function saveReport(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/api/admin/reports", { method: "PATCH", body: JSON.stringify({ reportId: selected.id, tasks }) });
      setMessage(`Report for ${selected.displayName} was updated and inventory effects were recalculated.`);
      await loadReports();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <div className="page-stack">
    <PageHeading eyebrow="Daily reports" title="Review and correct staff reports" copy="Edit a submitted report when work was missed. The inventory change is applied under the original staff member." action={<label className="archive-month-field">Report date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>} />
    {error && <div className="form-error">{error}</div>}
    {message && <div className="form-success">{message}</div>}
    <section className="dashboard-grid">
      <article className="content-card submission-card"><header className="section-header"><div><span className="eyebrow">Team reports</span><h2>{date}</h2></div><button className="button button-secondary" type="button" onClick={() => void loadReports()} disabled={busy}><Icon name="refresh" size={16} /> Refresh</button></header><div className="team-status-list">{reports.length ? reports.map((report) => <button className={`team-status-row ${report.id === selectedId ? "is-selected" : ""}`} key={report.id} type="button" onClick={() => setSelectedId(report.id)}><span className={`avatar avatar-${report.role}`}>{initials(report.displayName)}</span><div><strong>{report.displayName}</strong><small>{ROLE_LABELS[report.role]}</small></div><span className={`status-chip status-${report.status}`}>{report.status === "submitted" ? "Submitted" : "Draft"}</span></button>) : <div className="empty-state compact"><strong>No reports for this date</strong><p>Choose another date or wait for a staff report.</p></div>}</div></article>
      {selected ? <form className="content-card report-admin-editor" onSubmit={saveReport}><header className="section-header"><div><span className="eyebrow">{selected.displayName} · {ROLE_LABELS[selected.role]}</span><h2>{selected.status === "submitted" ? "Edit submitted report" : "Edit draft report"}</h2></div><span className="status-chip status-submitted">{selected.reportDate}</span></header><div className="admin-report-tasks">{tasks.map((task, index) => { const actions = ACTIONS[selected.role]; const action = actions.find((item) => item.value === task.actionType) ?? actions[0]; return <div className="task-editor" key={task.id ?? index}><div className="task-editor-heading"><strong>Task {index + 1}</strong><button className="text-button danger" type="button" onClick={() => setTasks((current) => current.filter((_, taskIndex) => taskIndex !== index))}>Remove</button></div><label>Action<select value={task.actionType} onChange={(event) => changeTask(index, { actionType: event.target.value, clientId: action?.scope === "agency" ? "" : task.clientId })}>{actions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{action?.scope !== "agency" && <label>Client<select value={task.clientId} onChange={(event) => changeTask(index, { clientId: event.target.value })}><option value="">Choose client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}<option value={OTHER_CLIENT_ID}>Other / Non-client work</option></select></label>}<div className="task-editor-fields"><label>Status<select value={task.status} onChange={(event) => changeTask(index, { status: event.target.value as ReportTask["status"] })}><option value="completed">Completed</option><option value="in_progress">In progress</option></select></label><label>Quantity<input type="number" min={1} max={50} value={task.quantity} onChange={(event) => changeTask(index, { quantity: Number(event.target.value) })} /></label></div><label>Notes<textarea rows={2} value={task.notes} onChange={(event) => changeTask(index, { notes: event.target.value })} /></label></div>; })}</div><div className="report-admin-actions"><button className="button button-secondary" type="button" onClick={() => setTasks((current) => [...current, newTask(selected.role, clients[0]?.id ?? "")])}>Add task</button><button className="button button-primary" disabled={busy || tasks.length === 0}>{busy ? "Saving…" : "Save and apply report"}</button></div><p className="muted">Saving replaces the report tasks, reverses the previous inventory movements, then applies the edited report using {selected.displayName} as the recorded actor.</p></form> : <article className="content-card empty-state"><strong>Select a report to edit</strong><p>Submitted and draft reports for the selected date appear on the left.</p></article>}
    </section>
  </div>;
}

function ActivityList({ items }: { items: HistoryItem[] }) {
  if (!items.length) {
    return (
      <div className="empty-state compact">
        <span className="empty-icon"><Icon name="activity" /></span>
        <strong>No activity yet</strong>
        <p>Submitted work and inventory changes will appear here.</p>
      </div>
    );
  }
  return (
    <div className="activity-list">
      {items.map((item) => (
          <div className="activity-row" key={item.id}>
            <span className={`avatar avatar-${item.actorRole}`}>{initials(item.actorName)}</span>
            <div>
              <p>
                <strong>{item.actorName}</strong>{" "}
                {ACTION_LABELS[item.actionType]?.toLowerCase() ?? item.actionType.replaceAll("_", " ")}
                {item.clientName && <> for <b>{item.clientName}</b></>}
              </p>
              <small>{item.notes || formatDate(item.date, true)}</small>
            </div>
            <InventoryDeltaChips item={item} />
          </div>
        ))}
    </div>
  );
}

function InventoryDeltaChips({
  item,
  showEmpty = false,
}: {
  item: HistoryItem;
  showEmpty?: boolean;
}) {
  const deltas = [
    ["Shot reel", item.shotReelDelta ?? 0],
    ["Finished reel", item.reelDelta ?? 0],
    ["Post", item.postDelta ?? 0],
    ["Draft", item.draftDelta ?? 0],
  ].filter((entry): entry is [string, number] => entry[1] !== 0);

  if (!deltas.length) {
    return showEmpty ? <span className="muted">No change</span> : null;
  }

  return (
    <span
      className="inventory-delta-chips"
      style={{
        display: "inline-flex",
        flexWrap: "wrap",
        justifyContent: "flex-end",
        gap: 4,
      }}
    >
      {deltas.map(([label, value]) => (
        <span
          className={`delta-chip ${value > 0 ? "positive" : "negative"}`}
          key={label}
        >
          {value > 0 ? "+" : ""}
          {value} {label}
        </span>
      ))}
    </span>
  );
}

function InventoryPage({
  clients,
  onChanged,
  canAdjust = true,
  reelsOnly = false,
}: {
  clients: Client[];
  onChanged: () => Promise<void>;
  canAdjust?: boolean;
  reelsOnly?: boolean;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [type, setType] = useState<
    "draft" | "shot_reel" | "reel" | "post"
  >("shot_reel");
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function adjust(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/api/admin/inventory", {
        method: "POST",
        body: JSON.stringify({ clientId, type, delta, reason }),
      });
      setMessage("Inventory updated and added to the audit log.");
      setReason("");
      await onChanged();
    } catch (adjustError) {
      setError((adjustError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow={canAdjust ? "Control panel" : "Read-only inventory"}
        title="Content inventory"
        copy={
          canAdjust
            ? "Follow every client from draft to filmed footage, finished content and publishing. Optional notes and every balance change remain in the audit log."
            : reelsOnly
              ? "See Shot reels waiting to be edited, Finished reels ready to publish, and which sessions should be prioritised."
              : "See every client’s Drafts, Shot reels, Finished reels and Posts. Only administrators can change these balances."
        }
      />
      <section className="inventory-summary">
        {!reelsOnly && (
          <div>
            <small>Drafts</small>
            <strong>
              {clients.reduce((sum, client) => sum + client.draftCount, 0)}
            </strong>
          </div>
        )}
        <div>
          <small>Shot reels to edit</small>
          <strong>
            {clients.reduce((sum, client) => sum + client.shotReelCount, 0)}
          </strong>
        </div>
        <div>
          <small>Finished reels</small>
          <strong>
            {clients.reduce((sum, client) => sum + client.reelCount, 0)}
          </strong>
        </div>
        {!reelsOnly && (
          <div>
            <small>Posts ready</small>
            <strong>
              {clients.reduce((sum, client) => sum + client.postCount, 0)}
            </strong>
          </div>
        )}
      </section>
      <section className={canAdjust ? "split-layout" : "inventory-readonly-layout"}>
        <div className="content-card">
          <header className="section-header">
            <div>
              <span className="eyebrow">Live balances</span>
              <h2>All clients</h2>
            </div>
          </header>
          <div className="inventory-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  {!reelsOnly && <th>Drafts</th>}
                  <th>Shot reels</th>
                  <th>Finished reels</th>
                  {!reelsOnly && <th>Posts</th>}
                  <th>Session status</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id}>
                    <td data-label="Client">
                      <span className="table-client">
                        <span className="client-monogram">{client.name.slice(0, 2)}</span>
                        <strong>{client.name}</strong>
                      </span>
                    </td>
                    {!reelsOnly && (
                      <td data-label="Drafts">
                        <span className="inventory-number">
                          {client.draftCount}
                        </span>
                      </td>
                    )}
                    <td data-label="Shot reels">
                      <span className="inventory-number">
                        {client.shotReelCount}
                      </span>
                    </td>
                    <td data-label="Finished reels">
                      <span className={client.needsSession ? "inventory-number warning" : "inventory-number"}>
                        {client.reelCount}
                      </span>
                    </td>
                    {!reelsOnly && (
                      <td data-label="Posts">
                        <span className="inventory-number">{client.postCount}</span>
                      </td>
                    )}
                    <td data-label="Session">
                      <span className={`status-chip ${client.needsSession ? "status-missing" : "status-submitted"}`}>
                        {client.needsSession ? "Session needed" : "Healthy"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {canAdjust && (
          <form className="content-card adjustment-card" onSubmit={adjust}>
            <span className="eyebrow">Manual adjustment</span>
            <h2>Add or remove content</h2>
            <p className="muted">
              Use positive numbers to add and negative numbers to take away.
            </p>
            <label>
              Client
              <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
                {clients.map((client) => (
                  <option value={client.id} key={client.id}>{client.name}</option>
                ))}
              </select>
            </label>
            <label>
              Content type
              <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
                <option value="draft">Content draft</option>
                <option value="shot_reel">Shot reel waiting for editing</option>
                <option value="reel">Finished reel</option>
                <option value="post">Post / design</option>
              </select>
            </label>
            <label>
              Change
              <div className="stepper">
                <button type="button" onClick={() => setDelta((value) => value - 1)}>−</button>
                <input
                  type="number"
                  value={delta}
                  onChange={(event) => setDelta(Number(event.target.value))}
                />
                <button type="button" onClick={() => setDelta((value) => value + 1)}>+</button>
              </div>
            </label>
            <label>
              Reason <span className="optional-label">Optional</span>
              <textarea
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Add a note only if useful"
              />
            </label>
            {error && <div className="form-error">{error}</div>}
            {message && <div className="form-success">{message}</div>}
            <button className="button button-primary button-wide" disabled={busy || delta === 0}>
              {busy ? "Updating…" : "Apply adjustment"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

function ClientsPage({
  clients,
  history,
  onChanged,
}: {
  clients: Client[];
  history: HistoryItem[];
  onChanged: () => Promise<void>;
}) {
  const [selected, setSelected] = useState(clients[0]?.id ?? "");
  const [addOpen, setAddOpen] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [sessionThreshold, setSessionThreshold] = useState(4);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editThreshold, setEditThreshold] = useState(4);
  const [editPayment, setEditPayment] = useState("0");
  const [editCurrency, setEditCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [portalDisplayName, setPortalDisplayName] = useState("");
  const [portalEmail, setPortalEmail] = useState("");
  const [portalPassword, setPortalPassword] = useState("");
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalMessage, setPortalMessage] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMessage, setLogoMessage] = useState("");
  const [kpiMonth, setKpiMonth] = useState(todayInDamascus().slice(0, 7));
  const [kpiGoal, setKpiGoal] = useState("");
  const [kpis, setKpis] = useState<MonthlyKpi[]>([]);
  const [kpiBusy, setKpiBusy] = useState(false);
  const [kpiMessage, setKpiMessage] = useState("");
  const client = clients.find((item) => item.id === selected) ?? clients[0];
  const clientHistory = history.filter((item) => item.clientName === client?.name);

  const loadKpis = useCallback(async () => {
    if (!client) {
      setKpis([]);
      return;
    }
    setKpiBusy(true);
    setError("");
    try {
      const result = await api<{ goals: MonthlyKpi[] }>(
        `/api/admin/client-kpis?clientId=${encodeURIComponent(client.id)}&month=${encodeURIComponent(kpiMonth)}`,
      );
      setKpis(result.goals);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setKpiBusy(false);
    }
  }, [client, kpiMonth]);

  useEffect(() => {
    setKpiMessage("");
    void loadKpis();
  }, [loadKpis]);

  useEffect(() => {
    if (!client) return;
    setEditName(client.name);
    setEditThreshold(client.sessionThreshold);
    setEditPayment((client.remainingPaymentCents / 100).toFixed(2));
    setEditCurrency(client.remainingPaymentCurrency || "USD");
  }, [client]);

  async function addKpi(event: FormEvent) {
    event.preventDefault();
    if (!client) return;
    setKpiBusy(true);
    setError("");
    setKpiMessage("");
    try {
      await api("/api/admin/client-kpis", {
        method: "POST",
        body: JSON.stringify({ clientId: client.id, month: kpiMonth, goal: kpiGoal }),
      });
      setKpiGoal("");
      await loadKpis();
      setKpiMessage("Monthly KPI goal added and published to the client portal.");
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setKpiBusy(false);
    }
  }

  async function toggleKpi(goal: MonthlyKpi) {
    setKpiBusy(true);
    setError("");
    setKpiMessage("");
    try {
      await api("/api/admin/client-kpis", {
        method: "PATCH",
        body: JSON.stringify({ id: goal.id, completed: !goal.completed }),
      });
      await loadKpis();
      setKpiMessage(
        goal.completed
          ? "KPI goal reopened in the team and client portal."
          : "KPI goal marked as achieved in the team and client portal.",
      );
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setKpiBusy(false);
    }
  }

  async function removeKpi(goal: MonthlyKpi) {
    if (!window.confirm(`Delete this KPI goal?\n\n${goal.goal}`)) return;
    setKpiBusy(true);
    setError("");
    setKpiMessage("");
    try {
      await api("/api/admin/client-kpis", {
        method: "DELETE",
        body: JSON.stringify({ id: goal.id }),
      });
      await loadKpis();
      setKpiMessage("KPI goal deleted.");
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setKpiBusy(false);
    }
  }

  async function addClient(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ client: Client; restored?: boolean }>("/api/clients", {
        method: "POST",
        body: JSON.stringify({
          name: newClientName,
          sessionThreshold,
        }),
      });
      setNewClientName("");
      setSessionThreshold(4);
      setAddOpen(false);
      setSelected(result.client.id);
      await onChanged();
      setMessage(
        result.restored
          ? `${result.client.name} was restored with its existing history and inventory.`
          : `${result.client.name} was added and is ready for the team.`,
      );
    } catch (addError) {
      setError((addError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeClient() {
    if (!client) return;
    const confirmed = window.confirm(
      `Remove ${client.name} from active clients?\n\n` +
        `Current inventory: ${client.draftCount} Drafts, ${client.shotReelCount} Shot reels, ${client.reelCount} Finished reels, ${client.postCount} Posts.\n\n` +
        "It will disappear from future reports, inventory and session choices. Past reports, inventory and history stay safe. Add the same name later to restore it.",
    );
    if (!confirmed) return;

    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/api/clients", {
        method: "DELETE",
        body: JSON.stringify({ id: client.id }),
      });
      setSelected(
        clients.find((item) => item.id !== client.id)?.id ?? "",
      );
      await onChanged();
      setMessage(
        `${client.name} was removed from active clients. Its records and inventory were preserved.`,
      );
    } catch (removeError) {
      setError((removeError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveClient(event: FormEvent) {
    event.preventDefault();
    if (!client) return;
    const amount = Number(editPayment);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Enter a valid remaining payment amount.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/api/clients", {
        method: "PATCH",
        body: JSON.stringify({
          id: client.id,
          name: editName,
          sessionThreshold: editThreshold,
          remainingPaymentCents: Math.round(amount * 100),
          remainingPaymentCurrency: editCurrency,
        }),
      });
      setEditOpen(false);
      await onChanged();
      setMessage(`${editName.trim().toUpperCase()} was updated.`);
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function savePortalAccess(event: FormEvent) {
    event.preventDefault();
    if (!client) return;
    setPortalBusy(true);
    setError("");
    setPortalMessage("");
    try {
      const result = await api<{ updated?: boolean }>("/api/admin/portal-users", {
        method: "POST",
        body: JSON.stringify({
          clientId: client.id,
          displayName: portalDisplayName,
          email: portalEmail,
          password: portalPassword,
        }),
      });
      setPortalPassword("");
      setPortalMessage(
        result.updated
          ? "Portal access was updated and previous client sessions were signed out."
          : "Portal access was created for this client.",
      );
    } catch (portalError) {
      setError((portalError as Error).message);
    } finally {
      setPortalBusy(false);
    }
  }

  async function uploadClientLogo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("clientId", client.id);
    setLogoBusy(true);
    setError("");
    setLogoMessage("");
    try {
      const response = await fetch("/api/admin/client-logo", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "The logo could not be uploaded.");
      }
      form.reset();
      await onChanged();
      setLogoMessage("Client logo updated. It is now visible in the portal.");
    } catch (logoError) {
      setError((logoError as Error).message);
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeClientLogo() {
    if (!client?.logoUrl) return;
    setLogoBusy(true);
    setError("");
    setLogoMessage("");
    try {
      const response = await fetch(
        `/api/admin/client-logo?clientId=${encodeURIComponent(client.id)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "The logo could not be removed.");
      }
      await onChanged();
      setLogoMessage("Client logo removed. The portal will use the client initials.");
    } catch (logoError) {
      setError((logoError as Error).message);
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Client hub"
        title="Every client, one clear story"
        copy="See available content, session health and a dated history of what the team produced or published."
        action={
          <button
            className="button button-primary"
            onClick={() => {
              setAddOpen((value) => !value);
              setError("");
              setMessage("");
            }}
          >
            <Icon name="plus" size={17} />
            {addOpen ? "Close" : "Add client"}
          </button>
        }
      />
      {error && <div className="form-error client-management-feedback">{error}</div>}
      {message && (
        <div className="form-success client-management-feedback">{message}</div>
      )}
      {addOpen && (
        <form className="content-card add-client-card" onSubmit={addClient}>
          <div>
            <span className="eyebrow">New client workspace</span>
            <h2>Add a client</h2>
            <p>
              The client starts with zero Drafts, Shot reels, Finished reels
              and Posts and receives its own history automatically. Entering a
              previously removed name restores its preserved workspace.
            </p>
          </div>
          <label>
            Client name
            <input
              value={newClientName}
              onChange={(event) => setNewClientName(event.target.value)}
              placeholder="Example: OZMO STUDIO"
              autoFocus
              required
            />
          </label>
          <label>
            Session warning at
            <div className="input-suffix">
              <input
                type="number"
                min={0}
                max={100}
                value={sessionThreshold}
                onChange={(event) =>
                  setSessionThreshold(Number(event.target.value))
                }
                required
              />
              <span>finished + shot reels left</span>
            </div>
          </label>
          <button
            className="button button-primary"
            disabled={busy || newClientName.trim().length < 2}
          >
            {busy ? "Adding…" : "Create client"}
          </button>
        </form>
      )}
      <div className="client-tabs">
        {clients.map((item) => (
          <button
            key={item.id}
            className={item.id === client?.id ? "active" : ""}
            onClick={() => setSelected(item.id)}
          >
            {item.name}
            {item.needsSession && <span />}
          </button>
        ))}
      </div>
      {client && (
        <>
          <section className="client-hero-card">
            <div className="client-title">
              {client.logoUrl ? (
                <span className="client-logo large">
                  <Image
                    src={client.logoUrl}
                    alt={`${client.name} logo`}
                    width={88}
                    height={88}
                    unoptimized
                  />
                </span>
              ) : (
                <span className="client-monogram large">{client.name.slice(0, 2)}</span>
              )}
              <div>
                <span className="eyebrow">Client workspace</span>
                <h1>{client.name}</h1>
                <p>{client.ozmoClientId}</p>
                <p>Last inventory change {formatDate(client.updatedAt, true)}</p>
              </div>
            </div>
            <div className="client-management-actions">
              <div className="client-stock">
                <div><small>Drafts</small><strong>{client.draftCount}</strong></div>
                <div><small>Shot reels</small><strong>{client.shotReelCount}</strong></div>
                <div><small>Finished reels</small><strong>{client.reelCount}</strong></div>
                <div><small>Posts</small><strong>{client.postCount}</strong></div>
                <span className={`health-pill ${client.needsSession ? "danger" : "healthy"}`}>
                  {client.needsSession
                    ? `Session needed · ${client.sessionThreshold} total reel threshold`
                    : `${client.reelCount + client.shotReelCount} reels in the pipeline`}
                </span>
              </div>
              <button
                type="button"
                className="button client-remove-button"
                onClick={() => {
                  setEditOpen((value) => !value);
                  setError("");
                }}
                disabled={busy}
              >
                <Icon name="edit" size={16} />
                {editOpen ? "Close edit" : "Edit client"}
              </button>
              <button
                type="button"
                className="button client-remove-button"
                onClick={() => void removeClient()}
                disabled={busy}
              >
                {busy ? "Working…" : "Remove client"}
              </button>
            </div>
          </section>
          {editOpen && (
            <form className="content-card add-client-card" onSubmit={saveClient}>
              <div>
                <span className="eyebrow">Client settings</span>
                <h2>Edit client</h2>
                <p>Update the client name, inventory warning threshold, or the payment balance shown in the client portal.</p>
              </div>
              <label>Client name<input value={editName} onChange={(event) => setEditName(event.target.value)} required /></label>
              <label>Session warning at<div className="input-suffix"><input type="number" min={0} max={100} value={editThreshold} onChange={(event) => setEditThreshold(Number(event.target.value))} required /><span>finished + shot reels left</span></div></label>
              <label>Remaining payment<div className="input-suffix"><input type="number" min={0} step="0.01" value={editPayment} onChange={(event) => setEditPayment(event.target.value)} required /><select value={editCurrency} onChange={(event) => setEditCurrency(event.target.value)}><option value="USD">USD</option><option value="EUR">EUR</option><option value="SYP">SYP</option></select></div></label>
              <button className="button button-primary" disabled={busy || editName.trim().length < 2}>{busy ? "Saving…" : "Save client changes"}</button>
            </form>
          )}
          <form className="content-card client-logo-card" onSubmit={uploadClientLogo}>
            <div className="client-logo-copy">
              <span className="eyebrow">Client branding</span>
              <h2>Portal logo</h2>
              <p>
                Upload a transparent PNG for a polished, client-specific portal.
                Maximum file size: 2 MB.
              </p>
              {logoMessage && <div className="form-success">{logoMessage}</div>}
            </div>
            <label className="client-logo-picker">
              PNG logo
              <input name="logo" type="file" accept="image/png,.png" required />
              <small>Square or horizontal logos work best on a transparent background.</small>
            </label>
            <div className="client-logo-buttons">
              <button className="button button-primary" disabled={logoBusy}>
                {logoBusy ? "Uploading..." : client.logoUrl ? "Replace logo" : "Upload logo"}
              </button>
              {client.logoUrl && (
                <button
                  className="button button-secondary"
                  disabled={logoBusy}
                  onClick={() => void removeClientLogo()}
                  type="button"
                >
                  Remove logo
                </button>
              )}
            </div>
          </form>
          <form className="content-card add-client-card" onSubmit={savePortalAccess}>
            <div>
              <span className="eyebrow">Client portal</span>
              <h2>Create or reset portal access</h2>
              <p>
                This login can see only {client.name} content and accounting
                data. Saving the same email resets its password and active sessions.
              </p>
              {portalMessage && <div className="form-success">{portalMessage}</div>}
            </div>
            <label>
              Contact name
              <input value={portalDisplayName} onChange={(event) => setPortalDisplayName(event.target.value)} placeholder="Client contact" required />
            </label>
            <label>
              Email
              <input type="email" value={portalEmail} onChange={(event) => setPortalEmail(event.target.value)} placeholder="client@example.com" required />
            </label>
            <label>
              Temporary password
              <input type="password" minLength={10} value={portalPassword} onChange={(event) => setPortalPassword(event.target.value)} autoComplete="new-password" required />
            </label>
            <button className="button button-primary" disabled={portalBusy || portalPassword.length < 10}>
              {portalBusy ? "Saving…" : "Save portal access"}
            </button>
          </form>
          <section className="content-card client-kpi-card">
            <header className="section-header client-kpi-header">
              <div>
                <span className="eyebrow">Monthly goals</span>
                <h2>KPI goals</h2>
                <p>Set measurable goals for {client.name}, then check them when the target is reached.</p>
              </div>
              <label className="client-kpi-month">
                Month
                <input
                  type="month"
                  value={kpiMonth}
                  onChange={(event) => setKpiMonth(event.target.value)}
                />
              </label>
            </header>
            <form className="client-kpi-add" onSubmit={addKpi}>
              <label>
                KPI goal
                <input
                  value={kpiGoal}
                  onChange={(event) => setKpiGoal(event.target.value)}
                  placeholder="Example: Raise follower views by 10%"
                  maxLength={240}
                  required
                />
              </label>
              <button className="button button-primary" disabled={kpiBusy || kpiGoal.trim().length < 3}>
                {kpiBusy ? "Saving…" : "Add KPI goal"}
              </button>
            </form>
            {kpiMessage && <div className="form-success">{kpiMessage}</div>}
            <div className="client-kpi-list" aria-live="polite">
              {kpiBusy && kpis.length === 0 ? (
                <p className="client-kpi-empty">Loading KPI goals…</p>
              ) : kpis.length === 0 ? (
                <p className="client-kpi-empty">No KPI goals set for this month yet.</p>
              ) : (
                kpis.map((goal) => (
                  <div className={`client-kpi-item ${goal.completed ? "completed" : ""}`} key={goal.id}>
                    <button
                      className="client-kpi-check"
                      type="button"
                      aria-pressed={goal.completed}
                      disabled={kpiBusy}
                      onClick={() => void toggleKpi(goal)}
                    >
                      <span className="client-kpi-checkmark" aria-hidden="true">
                        {goal.completed ? <Icon name="check" size={17} /> : <span />}
                      </span>
                      <span className="client-kpi-copy">
                        <strong>{goal.goal}</strong>
                        <small>{goal.completed ? "Target achieved" : "In progress"}</small>
                      </span>
                      <span className="client-kpi-action">
                        {goal.completed ? "Achieved" : "Mark as achieved"}
                      </span>
                    </button>
                    <button className="button button-secondary" type="button" disabled={kpiBusy} onClick={() => void removeKpi(goal)}>
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
          <section className="content-card">
            <header className="section-header">
              <div>
                <span className="eyebrow">Dated log</span>
                <h2>{client.name} history</h2>
              </div>
            </header>
            <ActivityList items={clientHistory} />
          </section>
        </>
      )}
    </div>
  );
}

function MonthArchivePage({
  clients,
  archives,
  onChanged,
}: {
  clients: Client[];
  archives: MonthArchive[];
  onChanged: () => Promise<void>;
}) {
  const [month, setMonth] = useState(todayInDamascus().slice(0, 7));
  const [notes, setNotes] = useState("");
  const [carry, setCarry] = useState<
    Record<
      string,
      { draft: number; shotReel: number; reel: number; post: number }
    >
  >({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(
    archives[0]?.id ?? null,
  );

  useEffect(() => {
    setCarry((current) => {
      const next = { ...current };
      for (const client of clients) {
        next[client.id] ??= { draft: 0, shotReel: 0, reel: 0, post: 0 };
      }
      return next;
    });
  }, [clients]);

  function updateCarry(
    clientId: string,
    contentType: "draft" | "shotReel" | "reel" | "post",
    value: number,
  ) {
    setCarry((current) => ({
      ...current,
      [clientId]: {
        ...(current[clientId] ?? {
          draft: 0,
          shotReel: 0,
          reel: 0,
          post: 0,
        }),
        [contentType]: Math.max(0, value || 0),
      },
    }));
  }

  async function closeMonth(event: FormEvent) {
    event.preventDefault();
    if (
      !window.confirm(
        `Archive ${month} and reset live inventory to the carry-over counts shown below?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await api("/api/admin/archives", {
        method: "POST",
        body: JSON.stringify({
          month,
          notes,
          carry: clients.map((client) => ({
            clientId: client.id,
            ...(carry[client.id] ?? {
              draft: 0,
              shotReel: 0,
              reel: 0,
              post: 0,
            }),
          })),
        }),
      });
      setMessage(
        `${month} was archived. Live inventory now contains only the selected carry-over content.`,
      );
      setNotes("");
      setCarry(
        Object.fromEntries(
          clients.map((client) => [
            client.id,
            { draft: 0, shotReel: 0, reel: 0, post: 0 },
          ]),
        ),
      );
      await onChanged();
    } catch (archiveError) {
      setError((archiveError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Month end"
        title="Close the month without losing history"
        copy="Archive the month manually, keep a permanent snapshot, then start the live inventory at zero or carry selected scheduled content into the next month."
      />
      <form className="content-card month-close-card" onSubmit={closeMonth}>
        <header className="section-header">
          <div>
            <span className="eyebrow">Manual month close</span>
            <h2>Choose what carries forward</h2>
            <p className="muted">
              Every box starts at zero. Enter only the content already planned
              for next month.
            </p>
          </div>
          <div className="archive-month-field">
            <label>
              Month
              <input
                type="month"
                value={month}
                max={todayInDamascus().slice(0, 7)}
                onChange={(event) => setMonth(event.target.value)}
                required
              />
            </label>
            <button
              type="button"
              className="button button-soft"
              onClick={() =>
                setCarry(
                  Object.fromEntries(
                    clients.map((client) => [
                      client.id,
                      {
                        draft: client.draftCount,
                        shotReel: client.shotReelCount,
                        reel: client.reelCount,
                        post: client.postCount,
                      },
                    ]),
                  ),
                )
              }
            >
              Carry all current
            </button>
          </div>
        </header>
        <div className="carry-grid">
          {clients.map((client) => {
            const values = carry[client.id] ?? {
              draft: 0,
              shotReel: 0,
              reel: 0,
              post: 0,
            };
            return (
              <article className="carry-client-card" key={client.id}>
                <header>
                  <span className="client-monogram">
                    {client.name.slice(0, 2)}
                  </span>
                  <div>
                    <strong>{client.name}</strong>
                    <small>
                      Current: {client.draftCount} Draft · {client.shotReelCount}{" "}
                      Shot · {client.reelCount} Finished · {client.postCount} Post
                    </small>
                  </div>
                </header>
                {(
                  [
                    ["draft", "Drafts", client.draftCount],
                    ["shotReel", "Shot reels", client.shotReelCount],
                    ["reel", "Finished reels", client.reelCount],
                    ["post", "Posts", client.postCount],
                  ] as const
                ).map(([type, label, maximum]) => (
                  <label key={type}>
                    <span>{label}</span>
                    <input
                      type="number"
                      min={0}
                      max={maximum}
                      inputMode="numeric"
                      value={values[type]}
                      onChange={(event) =>
                        updateCarry(
                          client.id,
                          type,
                          Number(event.target.value),
                        )
                      }
                    />
                    <small>of {maximum}</small>
                  </label>
                ))}
              </article>
            );
          })}
        </div>
        <label className="archive-notes">
          Archive note <span className="optional-label">Optional</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            placeholder="Example: August launch content carried forward"
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        {message && <div className="form-success">{message}</div>}
        <footer className="archive-actions">
          <span>
            Closing creates dated reset movements; it never deletes reports,
            tasks, sessions, or inventory history.
          </span>
          <button className="button button-primary" disabled={busy || !month}>
            {busy ? "Archiving…" : `Archive ${month}`}
          </button>
        </footer>
      </form>

      <section className="content-card">
        <header className="section-header">
          <div>
            <span className="eyebrow">{archives.length} archived months</span>
            <h2>Archive history</h2>
          </div>
        </header>
        <div className="archive-list">
          {archives.length ? (
            archives.map((archive) => {
              const isOpen = expanded === archive.id;
              const closingTotal = archive.inventory.reduce(
                (sum, row) => sum + row.closingQuantity,
                0,
              );
              const carryTotal = archive.inventory.reduce(
                (sum, row) => sum + row.carryQuantity,
                0,
              );
              return (
                <article className="archive-record" key={archive.id}>
                  <button
                    type="button"
                    className="archive-record-summary"
                    onClick={() => setExpanded(isOpen ? null : archive.id)}
                    aria-expanded={isOpen}
                  >
                    <div>
                      <span className="archive-month">{archive.month}</span>
                      <span>
                        Closed by {archive.closedByName} ·{" "}
                        {formatDate(archive.closedAt, true)}
                      </span>
                    </div>
                    <div className="archive-record-metrics">
                      <span>
                        <strong>{archive.taskCount}</strong> tasks
                      </span>
                      <span>
                        <strong>{archive.reportCount}</strong> reports
                      </span>
                      <span>
                        <strong>{closingTotal}</strong> closing
                      </span>
                      <span>
                        <strong>{carryTotal}</strong> carried
                      </span>
                    </div>
                    <span className={`archive-chevron ${isOpen ? "is-open" : ""}`}>
                      <Icon name="arrow" size={18} />
                    </span>
                  </button>
                  {isOpen && (
                    <div className="archive-record-detail">
                      {archive.notes && <p>{archive.notes}</p>}
                      <div className="archive-client-snapshots">
                        {clientsFromArchive(archive).map((client) => (
                          <div key={client.name}>
                            <strong>{client.name}</strong>
                            <span>
                              Drafts {client.draft.closing} → {client.draft.carry}
                            </span>
                            <span>
                              Shot reels {client.shotReel.closing} →{" "}
                              {client.shotReel.carry}
                            </span>
                            <span>
                              Finished reels {client.reel.closing} → {client.reel.carry}
                            </span>
                            <span>
                              Posts {client.post.closing} → {client.post.carry}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          ) : (
            <div className="empty-state">
              <span className="empty-icon">
                <Icon name="history" />
              </span>
              <strong>No archived months yet</strong>
              <p>Your first manual month close will appear here.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function clientsFromArchive(archive: MonthArchive) {
  const grouped = new Map<
    string,
    {
      name: string;
      shotReel: { closing: number; carry: number };
      reel: { closing: number; carry: number };
      post: { closing: number; carry: number };
      draft: { closing: number; carry: number };
    }
  >();
  for (const row of archive.inventory) {
    const current = grouped.get(row.clientName) ?? {
      name: row.clientName,
      shotReel: { closing: 0, carry: 0 },
      reel: { closing: 0, carry: 0 },
      post: { closing: 0, carry: 0 },
      draft: { closing: 0, carry: 0 },
    };
    const contentKey =
      row.contentType === "shot_reel" ? "shotReel" : row.contentType;
    current[contentKey] = {
      closing: row.closingQuantity,
      carry: row.carryQuantity,
    };
    grouped.set(row.clientName, current);
  }
  return [...grouped.values()];
}

function SessionsPage({
  user,
  clients,
  sessions,
  onChanged,
}: {
  user: User;
  clients: Client[];
  sessions: SessionItem[];
  onChanged: () => Promise<void>;
}) {
  const canManage = user.role === "admin" || user.role === "account_manager";
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [scheduledAt, setScheduledAt] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [completingSessionId, setCompletingSessionId] = useState<string | null>(
    null,
  );
  const [reelsShot, setReelsShot] = useState("");

  async function createSession(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          clientId,
          scheduledFor: new Date(`${scheduledAt}:00+03:00`).toISOString(),
          notes,
        }),
      });
      setScheduledAt("");
      setNotes("");
      await onChanged();
    } catch (sessionError) {
      setError((sessionError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function updateSession(
    id: string,
    status: SessionItem["status"],
    completedReelsShot?: number,
  ) {
    setError("");
    try {
      await api("/api/sessions", {
        method: "PUT",
        body: JSON.stringify({
          id,
          status,
          ...(status === "completed"
            ? { reelsShot: completedReelsShot }
            : {}),
        }),
      });
      setCompletingSessionId(null);
      setReelsShot("");
      await onChanged();
    } catch (sessionError) {
      setError((sessionError as Error).message);
    }
  }

  async function deleteSession(id: string) {
    if (
      !window.confirm(
        "Remove this session from the visible planner? Its audit record will be preserved.",
      )
    ) {
      return;
    }
    setError("");
    try {
      await api("/api/sessions", {
        method: "DELETE",
        body: JSON.stringify({ id }),
      });
      if (completingSessionId === id) {
        setCompletingSessionId(null);
        setReelsShot("");
      }
      await onChanged();
    } catch (sessionError) {
      setError((sessionError as Error).message);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Session planner"
        title="Plan the next content moment"
        copy="Clients with low finished + shot reel coverage are flagged. A scheduled session stays active until someone manually completes, cancels, misses or deletes it."
      />
      <section className="split-layout">
        <div className="content-card">
          <header className="section-header">
            <div>
              <span className="eyebrow">Schedule</span>
              <h2>Upcoming sessions</h2>
            </div>
            <span className="completion-pill">{sessions.filter((item) => item.status === "scheduled").length} planned</span>
          </header>
          <div className="session-list">
            {sessions.length ? (
              sessions.map((session) => (
                <article className="session-row" key={session.id}>
                  <div className="session-date">
                    <strong>{new Intl.DateTimeFormat("en-GB", { day: "2-digit", timeZone: "Asia/Damascus" }).format(new Date(session.scheduledAt))}</strong>
                    <span>{new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "Asia/Damascus" }).format(new Date(session.scheduledAt))}</span>
                  </div>
                  <div>
                    <span className="eyebrow">{formatDate(session.scheduledAt, true)}</span>
                    <h3>{session.clientName} session</h3>
                    <p>
                      {session.notes ||
                        `Scheduled by ${session.createdByName ?? "OZMO"}`}
                    </p>
                    {session.status === "completed" && (
                      <small className="session-output">
                        {session.reelsShot == null
                          ? "Reels shot not recorded"
                          : `${session.reelsShot} Shot reel${
                              session.reelsShot === 1 ? "" : "s"
                            } added to the editing queue`}
                      </small>
                    )}
                  </div>
                  <div className="session-actions">
                    <span className={`status-chip status-${session.status === "scheduled" ? "draft" : session.status === "completed" ? "submitted" : "missing"}`}>
                      {session.status}
                    </span>
                    {canManage && session.status === "scheduled" && (
                      <select
                        value=""
                        aria-label="Update session status"
                        onChange={(event) => {
                          if (event.target.value) {
                            const nextStatus = event.target
                              .value as SessionItem["status"];
                            if (nextStatus === "completed") {
                              setCompletingSessionId(session.id);
                              setReelsShot("");
                            } else {
                              void updateSession(session.id, nextStatus);
                            }
                          }
                        }}
                      >
                        <option value="">Update…</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                        <option value="missed">Missed</option>
                      </select>
                    )}
                    {canManage && (
                      <button
                        type="button"
                        className="text-button danger session-delete"
                        onClick={() => void deleteSession(session.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  {canManage &&
                    session.status === "scheduled" &&
                    completingSessionId === session.id && (
                      <div className="session-completion-form">
                        <label>
                          How many usable reels were shot?
                          <input
                            type="number"
                            min={0}
                            max={500}
                            inputMode="numeric"
                            value={reelsShot}
                            onChange={(event) =>
                              setReelsShot(event.target.value)
                            }
                            placeholder="0"
                            autoFocus
                          />
                        </label>
                        <div>
                          <button
                            type="button"
                            className="button button-ghost"
                            onClick={() => {
                              setCompletingSessionId(null);
                              setReelsShot("");
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="button button-primary"
                            disabled={
                              reelsShot === "" ||
                              !Number.isSafeInteger(Number(reelsShot)) ||
                              Number(reelsShot) < 0
                            }
                            onClick={() =>
                              void updateSession(
                                session.id,
                                "completed",
                                Number(reelsShot),
                              )
                            }
                          >
                            Complete & add Shot reels
                          </button>
                        </div>
                      </div>
                    )}
                </article>
              ))
            ) : (
              <div className="empty-state">
                <span className="empty-icon"><Icon name="calendar" /></span>
                <strong>No sessions scheduled</strong>
                <p>Planned client sessions will appear here.</p>
              </div>
            )}
          </div>
        </div>
        {canManage && (
          <form className="content-card adjustment-card" onSubmit={createSession}>
            <span className="eyebrow">New session</span>
            <h2>Schedule a session</h2>
            <p className="muted">
              The session stays scheduled until it is manually updated. Its
              account-manager creator receives a reminder every day at 11:00 AM.
            </p>
            <label>
              Client
              <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
                {clients.map((client) => (
                  <option value={client.id} key={client.id}>{client.name}</option>
                ))}
              </select>
            </label>
            <label>
              Date and time
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                required
              />
            </label>
            <label>
              Notes
              <textarea
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Location, concept or anything the team needs…"
              />
            </label>
            {error && <div className="form-error">{error}</div>}
            <button className="button button-primary button-wide" disabled={busy || !scheduledAt}>
              {busy ? "Scheduling…" : "Schedule session"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

type TeamProfileForm = {
  username: string;
  displayName: string;
  phone: string;
  role: Role;
  password: string;
};

const EMPTY_TEAM_PROFILE: TeamProfileForm = {
  username: "",
  displayName: "",
  phone: "",
  role: "editor",
  password: "",
};

const ROLE_ACCESS_COPY: Record<Role, string> = {
  admin: "Full dashboard, team and control-panel access",
  editor: "Converts Shot reels into Finished reels and manages their reports",
  designer: "Creates posts and manages their own daily reports",
  account_manager: "Publishes content, creates drafts and manages sessions",
};

function normalizeTeamUsername(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "zied" ? "zeid" : normalized;
}

function validateTeamProfile(
  form: TeamProfileForm,
  users: User[],
  editingId?: string | number,
) {
  const username = normalizeTeamUsername(form.username);
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) {
    return "Username must be 3–40 characters, start with a letter or number, and use only letters, numbers, dots, dashes or underscores.";
  }
  if (
    users.some(
      (member) =>
        member.id !== editingId &&
        normalizeTeamUsername(member.username) === username,
    )
  ) {
    return "That username is already in use.";
  }
  if (!form.displayName.trim() || form.displayName.trim().length > 80) {
    return "Enter the employee’s display name.";
  }
  const phone = form.phone.trim().replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    return "Enter a valid phone number, including the country code.";
  }
  if ((!editingId || form.password) && form.password.length < 10) {
    return "Password must contain at least 10 characters.";
  }
  if ((!editingId || form.password) && !/[a-z]/.test(form.password)) {
    return "Password must include a lowercase letter.";
  }
  if ((!editingId || form.password) && !/[A-Z]/.test(form.password)) {
    return "Password must include an uppercase letter.";
  }
  if ((!editingId || form.password) && !/[0-9]/.test(form.password)) {
    return "Password must include a number.";
  }
  return "";
}

function TeamPage({
  currentUser,
  users,
  onChanged,
}: {
  currentUser: User;
  users: User[];
  onChanged: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | number>(users[0]?.id ?? "");
  const [profileMode, setProfileMode] = useState<"create" | "edit" | null>(null);
  const [profile, setProfile] = useState<TeamProfileForm>(EMPTY_TEAM_PROFILE);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationTitle, setNotificationTitle] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [notificationTitleAr, setNotificationTitleAr] = useState("");
  const [notificationMessageAr, setNotificationMessageAr] = useState("");
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selected = users.find((user) => user.id === selectedId);
  const activeCount = users.filter((member) => member.isActive !== false).length;
  const inactiveCount = users.length - activeCount;
  const adminCount = users.filter(
    (member) => member.role === "admin" && member.isActive !== false,
  ).length;
  const configuredAdminCount = users.filter(
    (member) =>
      member.role === "admin" &&
      member.isActive !== false &&
      member.hasPassword !== false,
  ).length;
  const selectedIsSelf =
    selected !== undefined && String(selected.id) === String(currentUser.id);
  const selectedIsLastAdmin =
    selected?.role === "admin" &&
    selected.isActive !== false &&
    selected.hasPassword !== false &&
    configuredAdminCount === 1;

  useEffect(() => {
    if (!selected && users[0]) setSelectedId(users[0].id);
  }, [selected, users]);

  useEffect(() => {
    if (!profileMode && !confirmDeactivate && !notificationOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy || notificationBusy) return;
      setProfileMode(null);
      setConfirmDeactivate(false);
      setNotificationOpen(false);
      setError("");
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [profileMode, confirmDeactivate, notificationOpen, busy, notificationBusy]);

  function openCreateProfile() {
    setProfile({ ...EMPTY_TEAM_PROFILE });
    setError("");
    setMessage("");
    setProfileMode("create");
  }

  function openEditProfile() {
    if (!selected) return;
    setProfile({
      username: selected.username,
      displayName: selected.displayName,
      phone: selected.phone,
      role: selected.role,
      password: "",
    });
    setError("");
    setMessage("");
    setProfileMode("edit");
  }

  function updateProfileField<K extends keyof TeamProfileForm>(
    field: K,
    value: TeamProfileForm[K],
  ) {
    setProfile((current) => ({ ...current, [field]: value }));
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    const validationError = validateTeamProfile(
      profile,
      users,
      profileMode === "edit" ? selected?.id : undefined,
    );
    if (validationError) {
      setError(validationError);
      return;
    }
    if (profileMode === "edit" && !selected) return;

    setBusy(true);
    setError("");
    setMessage("");
    const payload = {
      ...(profileMode === "edit" ? { userId: Number(selected?.id) } : {}),
      username: normalizeTeamUsername(profile.username),
      displayName: profile.displayName.trim(),
      phone: profile.phone.trim().replace(/[\s().-]/g, ""),
      role: profile.role,
      ...(profile.password ? { password: profile.password } : {}),
      ...(profileMode === "create" ? { isActive: true } : {}),
    };

    try {
      await api("/api/admin/users", {
        method: profileMode === "create" ? "POST" : "PATCH",
        body: JSON.stringify(payload),
      });
      const savedName = profile.displayName.trim();
      setProfileMode(null);
      setProfile({ ...EMPTY_TEAM_PROFILE });
      setMessage(
        profileMode === "create"
          ? `${savedName} can now sign in to OZMO.`
          : `${savedName}’s profile was updated.`,
      );
      await onChanged();
    } catch (userError) {
      setError((userError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function changeAccess(isActive: boolean) {
    if (!selected) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/api/admin/users", {
        method: "PATCH",
        body: JSON.stringify({
          userId: Number(selected.id),
          isActive,
        }),
      });
      setConfirmDeactivate(false);
      setMessage(
        isActive
          ? `${selected.displayName} was restored to the team and can sign in again.`
          : `${selected.displayName} was removed from the active team. Their work history was preserved.`,
      );
      await onChanged();
    } catch (userError) {
      setError((userError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openNotificationComposer() {
    if (!selected || selected.isActive === false) return;
    setNotificationTitle("");
    setNotificationMessage("");
    setNotificationTitleAr("");
    setNotificationMessageAr("");
    setError("");
    setMessage("");
    setNotificationOpen(true);
  }

  async function sendTeamNotification(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (!notificationTitle.trim() || !notificationMessage.trim()) {
      setError("Add a title and message before sending.");
      return;
    }
    setNotificationBusy(true);
    setError("");
    try {
      const result = await api<{
        recipient: { displayName: string };
        delivery: { attempted: number; delivered: number };
        warning: string | null;
      }>("/api/admin/notifications", {
        method: "POST",
        body: JSON.stringify({
          recipientUserId: selected.id,
          title: notificationTitle.trim(),
          message: notificationMessage.trim(),
          titleAr: notificationTitleAr.trim() || undefined,
          messageAr: notificationMessageAr.trim() || undefined,
        }),
      });
      setNotificationOpen(false);
      setMessage(
        result.warning
          ? `${result.recipient.displayName} received the message inside OZMO. ${result.warning}`
          : `Notification sent to ${result.recipient.displayName}${result.delivery.delivered > 1 ? ` on ${result.delivery.delivered} devices` : ""}.`,
      );
    } catch (notificationError) {
      setError((notificationError as Error).message);
    } finally {
      setNotificationBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Admin access control"
        title="OZMO team"
        copy="Add, edit, remove or restore employee profiles. Removed employees cannot sign in, while all of their reports and activity history stay preserved."
        action={
          <button className="button button-primary" onClick={openCreateProfile}>
            <Icon name="plus" size={17} /> Add profile
          </button>
        }
      />

      <section className="team-overview" aria-label="Team overview">
        <div>
          <span className="team-overview-icon"><Icon name="team" size={18} /></span>
          <p><strong>{users.length}</strong><small>Stored profiles</small></p>
        </div>
        <div>
          <span className="team-overview-icon active"><Icon name="check" size={18} /></span>
          <p><strong>{activeCount}</strong><small>Active access</small></p>
        </div>
        <div>
          <span className="team-overview-icon admin"><Icon name="lock" size={18} /></span>
          <p><strong>{adminCount}</strong><small>Administrators</small></p>
        </div>
      </section>

      {message && <div className="form-success team-page-message">{message}</div>}
      {error && !profileMode && !confirmDeactivate && !notificationOpen && (
        <div className="form-error team-page-message">{error}</div>
      )}

      <section className="split-layout team-layout">
        <div className="content-card team-card">
          <div className="section-header team-card-header">
            <div>
              <span className="eyebrow">Directory</span>
              <h2>Employee profiles</h2>
            </div>
            <span className="directory-count">
              {activeCount} active · {inactiveCount} removed
            </span>
          </div>
          <div className="team-directory">
            {users.map((member) => {
              const accessState =
                member.isActive === false
                  ? "inactive"
                  : member.hasPassword === false
                    ? "pending"
                    : "active";
              const accessLabel =
                accessState === "inactive"
                  ? "Removed from team"
                  : accessState === "pending"
                    ? "Password needed"
                    : "Active";
              return (
              <button
                type="button"
                className={`directory-row ${member.id === selectedId ? "active" : ""}`}
                key={member.id}
                onClick={() => {
                  setSelectedId(member.id);
                  setError("");
                  setMessage("");
                }}
                aria-pressed={member.id === selectedId}
              >
                <span className={`avatar avatar-${member.role}`}>{initials(member.displayName)}</span>
                <span>
                  <strong>{member.displayName}</strong>
                  <small>@{member.username} · {member.phone}</small>
                </span>
                <em>
                  {accessState === "inactive" ? "Removed · " : ""}
                  {ROLE_LABELS[member.role]}
                </em>
                <i
                  className={accessState}
                  aria-label={accessLabel}
                />
              </button>
              );
            })}
          </div>
        </div>

        {selected ? (
          <aside className="content-card adjustment-card profile-summary-card">
            <div className="profile-summary-top">
              <span className={`avatar avatar-${selected.role} profile-summary-avatar`}>
                {initials(selected.displayName)}
              </span>
              <span
                className={`access-status ${
                  selected.isActive === false
                    ? "inactive"
                    : selected.hasPassword === false
                      ? "pending"
                      : ""
                }`}
              >
                <i />
                {selected.isActive === false
                  ? "Removed from team"
                  : selected.hasPassword === false
                    ? "Password needed"
                    : "Active"}
              </span>
            </div>
            <div>
              <span className="eyebrow">Selected profile</span>
              <h2>{selected.displayName}</h2>
              <p className="profile-username">@{selected.username}</p>
            </div>
            <div className="profile-facts">
              <div>
                <small>Role & permissions</small>
                <strong>{ROLE_LABELS[selected.role]}</strong>
                <p>{ROLE_ACCESS_COPY[selected.role]}</p>
              </div>
              <div>
                <small>Phone</small>
                <strong>{selected.phone}</strong>
              </div>
              <div>
                <small>Sign-in password</small>
                <strong>
                  {selected.hasPassword === false
                    ? "Not configured"
                    : "Securely configured"}
                </strong>
              </div>
            </div>
            <div className="profile-actions">
              <button
                type="button"
                className="button button-soft button-wide"
                onClick={openNotificationComposer}
                disabled={selected.isActive === false}
              >
                <Icon name="send" size={16} /> Send notification
              </button>
              <button
                type="button"
                className="button button-primary button-wide"
                onClick={openEditProfile}
              >
                <Icon name="edit" size={16} /> Edit profile
              </button>
              {selected.isActive === false ? (
                <button
                  type="button"
                  className="button button-soft button-wide"
                  onClick={() => changeAccess(true)}
                  disabled={busy}
                >
                  <Icon name="check" size={16} />
                  {busy ? "Restoring…" : "Restore to team"}
                </button>
              ) : (
                <button
                  type="button"
                  className="button button-danger-outline button-wide"
                  onClick={() => {
                    setError("");
                    setMessage("");
                    setConfirmDeactivate(true);
                  }}
                  disabled={busy || selectedIsSelf || selectedIsLastAdmin}
                >
                  <Icon name="lock" size={16} /> Remove from team
                </button>
              )}
            </div>
            {selectedIsSelf ? (
              <p className="last-admin-note">
                You cannot remove the administrator profile you are currently using.
              </p>
            ) : selectedIsLastAdmin ? (
              <p className="last-admin-note">
                Keep at least one active administrator. Add or restore another admin before removing this profile.
              </p>
            ) : null}
          </aside>
        ) : (
          <aside className="content-card profile-summary-card empty-profile-summary">
            <Icon name="team" size={26} />
            <strong>No profile selected</strong>
            <p>Choose a team member to review or edit their access.</p>
          </aside>
        )}
      </section>

      {profileMode && (
        <div className="modal-backdrop profile-modal-backdrop" role="presentation">
          <section
            className="profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-modal-title"
          >
            <header className="profile-modal-header">
              <div>
                <span className="eyebrow">
                  {profileMode === "create" ? "New OZMO account" : "Admin-only settings"}
                </span>
                <h2 id="profile-modal-title">
                  {profileMode === "create" ? "Add an employee profile" : "Edit employee profile"}
                </h2>
                <p>
                  {profileMode === "create"
                    ? "Create private sign-in details and choose the employee’s work permissions."
                    : "Update identity and access details. Existing work history stays unchanged."}
                </p>
              </div>
              <button
                type="button"
                className="modal-close profile-modal-close"
                onClick={() => {
                  setProfileMode(null);
                  setError("");
                }}
                aria-label="Close profile form"
                disabled={busy}
              >
                <Icon name="close" />
              </button>
            </header>

            <form className="profile-form" onSubmit={saveProfile}>
              <div className="profile-form-section">
                <div className="profile-form-section-title">
                  <span>01</span>
                  <div>
                    <strong>Profile details</strong>
                    <small>Used in the team directory and activity history.</small>
                  </div>
                </div>
                <div className="field-grid">
                  <label>
                    Display name
                    <input
                      value={profile.displayName}
                      onChange={(event) => updateProfileField("displayName", event.target.value)}
                      placeholder="Employee name"
                      autoComplete="name"
                      autoFocus
                      required
                    />
                  </label>
                  <label>
                    Phone number
                    <input
                      type="tel"
                      inputMode="tel"
                      value={profile.phone}
                      onChange={(event) => updateProfileField("phone", event.target.value)}
                      placeholder="+963…"
                      autoComplete="tel"
                      required
                    />
                  </label>
                </div>
                <div className="field-grid">
                  <label>
                    Username
                    <input
                      value={profile.username}
                      onChange={(event) => updateProfileField("username", event.target.value)}
                      placeholder="firstname"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                    />
                    <small>Lowercase letters, numbers, dots, dashes or underscores.</small>
                  </label>
                  <label>
                    Role
                    <select
                      value={profile.role}
                      onChange={(event) => updateProfileField("role", event.target.value as Role)}
                      disabled={profileMode === "edit" && selectedIsSelf}
                    >
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <option value={value} key={value}>{label}</option>
                      ))}
                    </select>
                    <small>
                      {profileMode === "edit" && selectedIsSelf
                        ? "Your signed-in administrator role cannot be removed here."
                        : ROLE_ACCESS_COPY[profile.role]}
                    </small>
                  </label>
                </div>
              </div>

              <div className="profile-form-section security-form-section">
                <div className="profile-form-section-title">
                  <span><Icon name="lock" size={14} /></span>
                  <div>
                    <strong>
                      {profileMode === "create" ? "Create password" : "Optional password reset"}
                    </strong>
                    <small>
                      {profileMode === "create"
                        ? "The employee uses this password for their first sign-in."
                        : "Leave this blank to keep the current password."}
                    </small>
                  </div>
                </div>
                <label>
                  {profileMode === "create" ? "Temporary password" : "New password"}
                  <input
                    type="password"
                    value={profile.password}
                    onChange={(event) => updateProfileField("password", event.target.value)}
                    placeholder={
                      profileMode === "create"
                        ? "At least 10 characters"
                        : "Leave blank to keep current password"
                    }
                    autoComplete="new-password"
                    minLength={profileMode === "create" || profile.password ? 10 : undefined}
                    required={profileMode === "create"}
                  />
                  <small>
                    Use 10+ characters with uppercase, lowercase and a number. Passwords are securely hashed and never displayed.
                  </small>
                </label>
              </div>

              {error && <div className="form-error">{error}</div>}

              <footer className="profile-modal-actions">
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => {
                    setProfileMode(null);
                    setError("");
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button className="button button-primary" disabled={busy}>
                  {busy
                    ? "Saving…"
                    : profileMode === "create"
                      ? "Create profile"
                      : "Save changes"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {notificationOpen && selected && (
        <div className="modal-backdrop profile-modal-backdrop" role="presentation">
          <section
            className="profile-modal team-notification-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-modal-title"
          >
            <header className="profile-modal-header notification-modal-header">
              <div>
                <span className="eyebrow">Private team notification</span>
                <h2 id="notification-modal-title">Send to {selected.displayName}</h2>
                <p>
                  The message appears inside OZMO and is also pushed to every phone
                  or browser that {selected.displayName} connected.
                </p>
              </div>
              <button
                type="button"
                className="modal-close profile-modal-close"
                onClick={() => {
                  setNotificationOpen(false);
                  setError("");
                }}
                aria-label="Close notification form"
                disabled={notificationBusy}
              >
                <Icon name="close" />
              </button>
            </header>
            <form className="profile-form" onSubmit={sendTeamNotification}>
              <div className="profile-form-section">
                <div className="notification-recipient">
                  <span className={`avatar avatar-${selected.role}`}>
                    {initials(selected.displayName)}
                  </span>
                  <div>
                    <strong>{selected.displayName}</strong>
                    <small>{ROLE_LABELS[selected.role]} · @{selected.username}</small>
                  </div>
                  <span className="access-status"><i /> Active</span>
                </div>
                <label>
                  Notification title
                  <input
                    value={notificationTitle}
                    onChange={(event) => setNotificationTitle(event.target.value)}
                    placeholder="Important OZMO update"
                    maxLength={100}
                    autoFocus
                    required
                  />
                </label>
                <label>
                  Message
                  <textarea
                    value={notificationMessage}
                    onChange={(event) => setNotificationMessage(event.target.value)}
                    placeholder="Write the message this employee should receive…"
                    rows={4}
                    maxLength={500}
                    required
                  />
                  <small>{notificationMessage.length}/500 characters</small>
                </label>
              </div>
              <div className="profile-form-section notification-arabic-section">
                <div className="profile-form-section-title">
                  <span>ع</span>
                  <div>
                    <strong>Arabic copy · اختياري</strong>
                    <small>Leave blank to reuse the primary title and message.</small>
                  </div>
                </div>
                <label>
                  Arabic title
                  <input
                    dir="rtl"
                    value={notificationTitleAr}
                    onChange={(event) => setNotificationTitleAr(event.target.value)}
                    placeholder="عنوان الإشعار"
                    maxLength={100}
                  />
                </label>
                <label>
                  Arabic message
                  <textarea
                    dir="rtl"
                    value={notificationMessageAr}
                    onChange={(event) => setNotificationMessageAr(event.target.value)}
                    placeholder="اكتب الرسالة هنا…"
                    rows={3}
                    maxLength={500}
                  />
                </label>
              </div>
              {error && <div className="form-error notification-form-error">{error}</div>}
              <footer className="profile-modal-actions">
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => {
                    setNotificationOpen(false);
                    setError("");
                  }}
                  disabled={notificationBusy}
                >
                  Cancel
                </button>
                <button className="button button-primary" disabled={notificationBusy}>
                  {notificationBusy ? "Sending…" : "Send notification"}
                  {!notificationBusy && <Icon name="send" size={16} />}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {confirmDeactivate && selected && (
        <div className="modal-backdrop profile-modal-backdrop" role="presentation">
          <section
            className="confirm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="deactivate-title"
            aria-describedby="deactivate-copy"
          >
            <span className="confirm-modal-icon"><Icon name="lock" size={22} /></span>
            <span className="eyebrow">Confirm team removal</span>
            <h2 id="deactivate-title">Remove {selected.displayName} from the team?</h2>
            <p id="deactivate-copy">
              They will no longer be able to sign in or receive reminders. Their
              reports, sessions and activity history will remain safely stored,
              and you can restore them later.
            </p>
            {error && <div className="form-error">{error}</div>}
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="button button-ghost"
                onClick={() => {
                  setConfirmDeactivate(false);
                  setError("");
                }}
                disabled={busy}
                autoFocus
              >
                Keep on team
              </button>
              <button
                type="button"
                className="button button-danger"
                onClick={() => changeAccess(false)}
                disabled={busy}
              >
                {busy ? "Removing…" : "Remove from team"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function HistoryPage({
  items,
  ownOnly = false,
  onChanged,
}: {
  items: HistoryItem[];
  ownOnly?: boolean;
  onChanged?: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const filtered = items.filter((item) => {
    const haystack = `${item.actorName} ${item.clientName ?? ""} ${item.actionType} ${item.notes ?? ""}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  async function hideHistoryItem(item: HistoryItem) {
    if (
      !window.confirm(
        "Remove this entry from the visible task log? Inventory and the protected audit record will not be deleted.",
      )
    ) {
      return;
    }
    setDeletingId(item.id);
    setError("");
    try {
      await api("/api/history", {
        method: "DELETE",
        body: JSON.stringify({ id: item.id }),
      });
      await onChanged?.();
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow={ownOnly ? "Your record" : "Audit trail"}
        title={ownOnly ? "Your task history" : "Production & task history"}
        copy={
          ownOnly
            ? "A dated record of the work you submitted. Inventory effects remain visible where relevant."
            : "Every submitted task, content change and manual adjustment—dated and attributed. Admin removal hides an error without destroying its protected audit record."
        }
      />
      <section className="content-card">
        <header className="section-header history-header">
          <div>
            <span className="eyebrow">{filtered.length} entries</span>
            <h2>{ownOnly ? "Your completed work" : "Company activity log"}</h2>
          </div>
          <input
            className="search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search client, person or task…"
          />
        </header>
        {error && <div className="form-error history-error">{error}</div>}
        <div className="history-table-wrap">
          <table className="data-table history-table">
            <thead>
              <tr>
                <th>Date</th>
                {!ownOnly && <th>Employee</th>}
                <th>Client</th>
                <th>Action</th>
                <th>Task / note</th>
                <th>Inventory</th>
                {!ownOnly && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Date">{formatDate(item.date)}</td>
                    {!ownOnly && (
                      <td data-label="Employee">
                        <span className="table-person">
                          <span className={`avatar avatar-${item.actorRole}`}>{initials(item.actorName)}</span>
                          <strong>{item.actorName}</strong>
                        </span>
                      </td>
                    )}
                    <td data-label="Client"><strong>{item.clientName ?? "Company"}</strong></td>
                    <td data-label="Action">{ACTION_LABELS[item.actionType] ?? item.actionType.replaceAll("_", " ")}</td>
                    <td data-label="Task / note" className="notes-cell">{item.notes || "—"}</td>
                    <td data-label="Inventory">
                      <InventoryDeltaChips item={item} showEmpty />
                    </td>
                    {!ownOnly && (
                      <td data-label="Actions">
                        <button
                          type="button"
                          className="text-button danger"
                          disabled={deletingId === item.id}
                          onClick={() => void hideHistoryItem(item)}
                        >
                          {deletingId === item.id ? "Removing…" : "Delete"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
          {!filtered.length && (
            <div className="empty-state">
              <span className="empty-icon"><Icon name="history" /></span>
              <strong>No matching history</strong>
              <p>Try a different search or submit the first task.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function getNotificationSetupCopy(
  notificationStatus: BrowserNotificationStatus | null,
) {
  if (!notificationStatus) {
    return {
      summary: "Checking this device…",
      detail: "جارٍ فحص المتصفح والجهاز…",
      action: "Checking…",
    };
  }

  switch (notificationStatus.issue) {
    case "ready":
      return {
        summary: "Background notifications are connected",
        detail:
          "Tap Send test to confirm this device can receive OZMO alerts while the app is closed. · اضغط إرسال اختبار للتأكد من إشعارات الخلفية",
        action: "Send test",
      };
    case "subscription_required":
      return {
        summary: "Permission allowed · device connection needed",
        detail:
          "Tap Connect to register this browser for background OZMO alerts. اضغط اتصال لتفعيل الإشعارات.",
        action: "Connect",
      };
    case "test_failed":
      return {
        summary: "Device connected · test delivery failed",
        detail:
          "The subscription was kept. Check internet access on the OZMO computer, then retry the test.",
        action: "Retry test",
      };
    case "certificate_untrusted":
      return {
        summary: "OZMO certificate is not trusted on this device",
        detail:
          "Reinstall the current OZMO office certificate in the device’s trusted CA/root store, completely close the browser, then reopen OZMO. أعد تثبيت شهادة OZMO الموثوقة.",
        action: "Retry connection",
      };
    case "push_provider_unavailable":
      return {
        summary: "The browser push connection is unavailable",
        detail:
          "Update Chrome, Edge or Samsung Internet and confirm the phone’s Google Play Services or browser push service is working.",
        action: "Retry connection",
      };
    case "https_required":
      return {
        summary: "Trusted HTTPS is required on phones",
        detail:
          "Plain HTTP on a 192.168.x.x office address is blocked by Chrome, Samsung Internet and Safari. افتح رابط HTTPS موثوق.",
        action: "Check again",
      };
    case "ios_install_required":
      return {
        summary: "Install OZMO on the iPhone first",
        detail:
          "Safari → Share → Add to Home Screen. Open OZMO from its Home Screen icon, then tap Enable. Requires iOS 16.4 or newer.",
        action: "Check again",
      };
    case "permission_blocked":
      return {
        summary: `Blocked in ${notificationStatus.browserLabel} settings`,
        detail: notificationStatus.isIos
          ? "Open iPhone Settings → Notifications → OZMO and allow notifications, then return here."
          : notificationStatus.isAndroid
            ? `Open ${notificationStatus.browserLabel} → Site settings → Notifications → Allow. Then Android Settings → Notifications → ${notificationStatus.browserLabel} → allow Lock screen notifications.`
            : `Open this site’s permissions in ${notificationStatus.browserLabel}, change Notifications to Allow, and confirm ${notificationStatus.browserLabel} is allowed in the computer’s notification settings.`,
        action: "Check again",
      };
    case "permission_required":
      return {
        summary: "Ready to ask for permission",
        detail:
          "Tap Enable once. The browser permission prompt must be opened by your tap. اضغط تفعيل مرة واحدة.",
        action: "Enable",
      };
    default:
      return {
        summary: "Notifications are not available in this browser",
        detail: notificationStatus.isIos
          ? "Use iOS 16.4 or newer, install OZMO from Safari to the Home Screen, and open the installed app."
          : "Update Chrome or Samsung Internet and make sure Service Workers are enabled.",
        action: "Check again",
      };
  }
}

function SettingsPage({
  settings,
  onChanged,
}: {
  settings: SettingsData;
  onChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState(settings);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationStatus, setNotificationStatus] =
    useState<BrowserNotificationStatus | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState<
    string | number | null
  >(settings.staffSchedules?.[0]?.userId ?? null);

  useEffect(() => {
    if (!dirty) {
      setForm(settings);
    }
    setSelectedScheduleId((current) => {
      if (
        current != null &&
        settings.staffSchedules?.some(
          (schedule) => String(schedule.userId) === String(current),
        )
      ) {
        return current;
      }
      return settings.staffSchedules?.[0]?.userId ?? null;
    });
    void getBrowserNotificationStatus().then(setNotificationStatus);
  }, [settings, dirty]);

  function update<K extends keyof SettingsData>(key: K, value: SettingsData[K]) {
    setDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateStaffSchedule(
    userId: string | number,
    patch: Partial<
      Pick<StaffSchedule, "workStart" | "workEnd" | "workDays">
    >,
  ) {
    setDirty(true);
    setForm((current) => ({
      ...current,
      staffSchedules: (current.staffSchedules ?? []).map((schedule) =>
        String(schedule.userId) === String(userId)
          ? { ...schedule, ...patch }
          : schedule,
      ),
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ settings: SettingsData }>("/api/settings", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm(result.settings);
      setDirty(false);
      setMessage(
        "Settings saved. Work hours, report locks and reminders now use these values.",
      );
      await onChanged();
    } catch (settingsError) {
      setError((settingsError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function requestNotifications() {
    setNotificationBusy(true);
    try {
      const status =
        notificationStatus?.issue === "permission_required" ||
        notificationStatus?.issue === "subscription_required" ||
        notificationStatus?.issue === "test_failed" ||
        notificationStatus?.issue === "certificate_untrusted" ||
        notificationStatus?.issue === "push_provider_unavailable" ||
        notificationStatus?.issue === "ready"
          ? await enableBrowserNotifications()
          : await getBrowserNotificationStatus();
      setNotificationStatus(status);
    } finally {
      setNotificationBusy(false);
    }
  }

  const notificationCopy = getNotificationSetupCopy(notificationStatus);
  const notificationDetail =
    notificationStatus?.lastError ?? notificationCopy.detail;
  const selectedSchedule = form.staffSchedules?.find(
    (schedule) =>
      String(schedule.userId) === String(selectedScheduleId),
  );
  const selectedHasOverride = Boolean(
    selectedSchedule &&
      (selectedSchedule.workStart !== null ||
        selectedSchedule.workEnd !== null ||
        selectedSchedule.workDays !== null),
  );
  const selectedHasPersonalHours = Boolean(
    selectedSchedule &&
      (selectedSchedule.workStart !== null ||
        selectedSchedule.workEnd !== null),
  );

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Control panel"
        title="Rules & notifications"
        copy="All timing uses Asia/Damascus. Saved changes immediately control report access, reminders, working hours and individual days off."
      />
      <form onSubmit={save} className="settings-grid">
        <section className="content-card settings-section">
          <header>
            <span className="settings-icon"><Icon name="history" /></span>
            <div><h2>Daily report timing</h2><p>When staff and managers are notified.</p></div>
          </header>
          <div className="field-grid">
            <label>Company starts<input type="time" value={form.workStart} onChange={(event) => update("workStart", event.target.value)} /></label>
            <label>Company closes<input type="time" value={form.workEnd} onChange={(event) => update("workEnd", event.target.value)} /></label>
            <label>First reminder<input type="time" value={form.firstReminder} onChange={(event) => update("firstReminder", event.target.value)} /></label>
            <label>Second reminder<input type="time" value={form.secondReminder} onChange={(event) => update("secondReminder", event.target.value)} /></label>
            <label>Report deadline<input type="time" value={form.reportDeadline} onChange={(event) => update("reportDeadline", event.target.value)} /></label>
            <label>Manager escalation<input type="time" value={form.escalationTime} onChange={(event) => update("escalationTime", event.target.value)} /></label>
          </div>
          <div className="workday-row">
            <span>
              <strong>Company working days</strong>
              <small>{formatWorkDays(form.workDays)}</small>
            </span>
            {[
              ["Sat", 6],
              ["Sun", 0],
              ["Mon", 1],
              ["Tue", 2],
              ["Wed", 3],
              ["Thu", 4],
              ["Fri", 5],
            ].map(([label, value]) => (
              <button
                type="button"
                key={value}
                className={form.workDays.includes(Number(value)) ? "active" : ""}
                aria-pressed={form.workDays.includes(Number(value))}
                onClick={() => {
                  const day = Number(value);
                  update(
                    "workDays",
                    form.workDays.includes(day)
                      ? form.workDays.filter((item) => item !== day)
                      : [...form.workDays, day],
                  );
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="content-card settings-section staff-schedule-section">
          <header>
            <span className="settings-icon"><Icon name="team" /></span>
            <div>
              <h2>Individual schedules & days off</h2>
              <p>Override the company schedule only for employees who need it.</p>
            </div>
          </header>
          {form.staffSchedules?.length ? (
            <>
              <label>
                Employee
                <select
                  value={String(selectedScheduleId ?? "")}
                  onChange={(event) => setSelectedScheduleId(event.target.value)}
                >
                  {form.staffSchedules.map((schedule) => (
                    <option value={String(schedule.userId)} key={schedule.userId}>
                      {schedule.displayName} · {ROLE_LABELS[schedule.role]}
                    </option>
                  ))}
                </select>
              </label>
              {selectedSchedule && (
                <>
                  <div className="selected-schedule-person">
                    <span className={`avatar avatar-${selectedSchedule.role}`}>
                      {initials(selectedSchedule.displayName)}
                    </span>
                    <div>
                      <strong>{selectedSchedule.displayName}</strong>
                      <small>
                        Current effective schedule:{" "}
                        {formatClock(
                          selectedHasOverride
                            ? selectedSchedule.workStart ?? form.workStart
                            : form.workStart,
                        )}{" "}
                        —{" "}
                        {formatClock(
                          selectedHasOverride
                            ? selectedSchedule.workEnd ?? form.workEnd
                            : form.workEnd,
                        )}
                      </small>
                    </div>
                  </div>
                  <label className="toggle-row">
                    <span>
                      <strong>Use a personal schedule</strong>
                      <small>
                        Turn this on to assign different hours or regular days off.
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={selectedHasOverride}
                      onChange={(event) => {
                        if (event.target.checked) {
                          updateStaffSchedule(selectedSchedule.userId, {
                            workStart: null,
                            workEnd: null,
                            workDays:
                              selectedSchedule.effectiveWorkDays.length > 0
                                ? selectedSchedule.effectiveWorkDays
                                : form.workDays,
                          });
                        } else {
                          updateStaffSchedule(selectedSchedule.userId, {
                            workStart: null,
                            workEnd: null,
                            workDays: null,
                          });
                        }
                      }}
                    />
                  </label>
                  {selectedHasOverride && (
                    <div className="personal-schedule-editor">
                      <label className="toggle-row">
                        <span>
                          <strong>Use personal working hours</strong>
                          <small>
                            Keep this off to inherit future company hour changes.
                          </small>
                        </span>
                        <input
                          type="checkbox"
                          checked={selectedHasPersonalHours}
                          onChange={(event) =>
                            updateStaffSchedule(selectedSchedule.userId, {
                              workStart: event.target.checked
                                ? selectedSchedule.workStart ?? form.workStart
                                : null,
                              workEnd: event.target.checked
                                ? selectedSchedule.workEnd ?? form.workEnd
                                : null,
                            })
                          }
                        />
                      </label>
                      {selectedHasPersonalHours && (
                        <div className="field-grid">
                          <label>
                            Starts
                            <input
                              type="time"
                              value={
                                selectedSchedule.workStart ??
                                form.workStart
                              }
                              onChange={(event) =>
                                updateStaffSchedule(selectedSchedule.userId, {
                                  workStart: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Ends
                            <input
                              type="time"
                              value={
                                selectedSchedule.workEnd ??
                                form.workEnd
                              }
                              onChange={(event) =>
                                updateStaffSchedule(selectedSchedule.userId, {
                                  workEnd: event.target.value,
                                })
                              }
                            />
                          </label>
                        </div>
                      )}
                      <div className="workday-row personal-workdays">
                        <span>
                          <strong>Personal working days</strong>
                          <small>Days left off are treated as regular days off.</small>
                        </span>
                        {WORKDAY_LABELS.map((label, day) => {
                          const days =
                            selectedSchedule.workDays ??
                            selectedSchedule.effectiveWorkDays;
                          return (
                            <button
                              type="button"
                              key={label}
                              className={days.includes(day) ? "active" : ""}
                              aria-pressed={days.includes(day)}
                              onClick={() =>
                                updateStaffSchedule(selectedSchedule.userId, {
                                  workDays: days.includes(day)
                                    ? days.filter((item) => item !== day)
                                    : [...days, day].sort(
                                        (left, right) => left - right,
                                      ),
                                })
                              }
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="empty-state compact">
              <strong>No staff schedules loaded</strong>
              <p>Refresh the page after the scheduling update finishes.</p>
            </div>
          )}
        </section>

        <section className="content-card settings-section">
          <header>
            <span className="settings-icon"><Icon name="box" /></span>
            <div><h2>Inventory health</h2><p>When clients are marked for attention.</p></div>
          </header>
          <div className="field-grid">
            <label>
              Session needed at reels
              <input type="number" min={0} value={form.sessionThreshold} onChange={(event) => update("sessionThreshold", Number(event.target.value))} />
              <small>Triggers at this number or fewer.</small>
            </label>
            <label>
              Low post threshold
              <input
                type="number"
                min={0}
                value={form.postThreshold ?? ""}
                onChange={(event) => update("postThreshold", event.target.value === "" ? null : Number(event.target.value))}
                placeholder="Disabled"
              />
              <small>Leave empty to disable.</small>
            </label>
            <label>
              Low draft threshold
              <input
                type="number"
                min={0}
                value={form.draftThreshold ?? ""}
                onChange={(event) => update("draftThreshold", event.target.value === "" ? null : Number(event.target.value))}
                placeholder="Disabled"
              />
              <small>Leave empty to disable.</small>
            </label>
            <label>
              Daily session reminder
              <input
                type="time"
                value={form.sessionReminderTime}
                onChange={(event) =>
                  update("sessionReminderTime", event.target.value)
                }
              />
              <small>Sent every day to the account manager who scheduled it.</small>
            </label>
          </div>
        </section>

        <section className="content-card settings-section integration-section">
          <header>
            <span className="settings-icon"><Icon name="bell" /></span>
            <div><h2>Notification channels</h2><p>How updates reach the team.</p></div>
          </header>
          <div className="integration-list">
            <div className="integration-row">
              <span className="integration-logo browser-logo"><Icon name="bell" /></span>
              <div>
                <strong>Browser notifications</strong>
                <small>{notificationCopy.summary}</small>
              </div>
              <button
                type="button"
                className="button button-soft"
                onClick={requestNotifications}
                disabled={
                  notificationBusy ||
                  !notificationStatus
                }
              >
                {notificationBusy ? "Checking…" : notificationCopy.action}
              </button>
            </div>
            <div className="integration-row">
              <span className="integration-logo whatsapp-logo">W</span>
              <div>
                <strong>WhatsApp Cloud API</strong>
                <small>Not connected · credentials and approved templates required</small>
              </div>
              <span className="status-chip status-draft">Later</span>
            </div>
            <div className="integration-row">
              <span className="integration-logo network-logo"><Icon name="lock" /></span>
              <div>
                <strong>Office-only access</strong>
                <small>Private hosts, localhost and local network addresses only</small>
              </div>
              <span className="status-chip status-submitted">Active</span>
            </div>
          </div>
          <div
            className={`notification-diagnostic notification-diagnostic-${notificationStatus?.issue ?? "checking"}`}
            role="status"
          >
            <Icon
              name={notificationStatus?.issue === "ready" ? "check" : "activity"}
              size={18}
            />
            <div>
              <strong>{notificationCopy.summary}</strong>
              <span>{notificationDetail}</span>
              {notificationStatus && (
                <small>
                  HTTPS {notificationStatus.secureContext ? "✓" : "✕"} · Worker
                  registered {notificationStatus.serviceWorkerRegistered ? "✓" : "✕"} ·
                  Push API {notificationStatus.pushManagerSupported ? "✓" : "✕"}
                </small>
              )}
            </div>
          </div>
          <label className="toggle-row inventory-alert-toggle">
            <span>
              <strong>Inventory alerts active</strong>
              <small>
                Keep this off until the opening Reel, Post and Draft balances
                have been entered.
              </small>
            </span>
            <input
              type="checkbox"
              checked={form.inventoryReady}
              onChange={(event) => update("inventoryReady", event.target.checked)}
            />
          </label>
        </section>

        <section className="content-card settings-section">
          <header>
            <span className="settings-icon"><Icon name="activity" /></span>
            <div><h2>Manager summaries</h2><p>Daily and weekly operations snapshots.</p></div>
          </header>
          <div className="field-grid">
            <label>Daily summary<input type="time" value={form.dailySummaryTime} onChange={(event) => update("dailySummaryTime", event.target.value)} /></label>
            <label>
              Weekly day
              <select value={form.weeklySummaryDay} onChange={(event) => update("weeklySummaryDay", Number(event.target.value))}>
                <option value={6}>Saturday</option>
                <option value={0}>Sunday</option>
                <option value={1}>Monday</option>
                <option value={2}>Tuesday</option>
                <option value={3}>Wednesday</option>
                <option value={4}>Thursday</option>
                <option value={5}>Friday</option>
              </select>
            </label>
            <label>Weekly summary time<input type="time" value={form.weeklySummaryTime} onChange={(event) => update("weeklySummaryTime", event.target.value)} /></label>
          </div>
        </section>
        {error && <div className="form-error settings-message">{error}</div>}
        {message && <div className="form-success settings-message">{message}</div>}
        <div className="settings-save">
          <button className="button button-primary" disabled={busy}>
            {busy ? "Saving settings…" : "Save all settings"} <Icon name="check" size={17} />
          </button>
        </div>
      </form>
    </div>
  );
}

function BrowserNotificationSetupCard() {
  const [deviceSetupLink, setDeviceSetupLink] = useState(
    "http://192.168.1.196:3001",
  );
  const [status, setStatus] = useState<BrowserNotificationStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDeviceSetupLink(getDeviceSetupUrl());
    void getBrowserNotificationStatus().then(setStatus);
  }, []);

  async function handleSetup() {
    setBusy(true);
    try {
      const shouldEnable =
        status?.issue === "permission_required" ||
        status?.issue === "subscription_required" ||
        status?.issue === "test_failed" ||
        status?.issue === "certificate_untrusted" ||
        status?.issue === "push_provider_unavailable" ||
        status?.issue === "ready";
      setStatus(
        shouldEnable
          ? await enableBrowserNotifications()
          : await getBrowserNotificationStatus(),
      );
    } finally {
      setBusy(false);
    }
  }

  const copy = getNotificationSetupCopy(status);
  const detail = status?.lastError ?? copy.detail;

  return (
    <section className="content-card notification-setup-card">
      <header>
        <span className="settings-icon"><Icon name="bell" /></span>
        <div>
          <span className="eyebrow">This device</span>
          <h2>Set up browser notifications</h2>
          <p>فعّل إشعارات المتصفح على كل جهاز تستخدمه</p>
        </div>
      </header>
      <div
        className={`notification-diagnostic notification-diagnostic-${status?.issue ?? "checking"}`}
        role="status"
      >
        <Icon name={status?.issue === "ready" ? "check" : "activity"} size={18} />
        <div>
          <strong>{copy.summary}</strong>
          <span>{detail}</span>
          {status && (
            <small>
              HTTPS {status.secureContext ? "✓" : "✕"} · Worker registered{" "}
              {status.serviceWorkerRegistered ? "✓" : "✕"} · Push API{" "}
              {status.pushManagerSupported ? "✓" : "✕"}
            </small>
          )}
        </div>
      </div>
      <button
        type="button"
        className="button button-primary"
        onClick={handleSetup}
        disabled={busy || !status}
      >
        {busy ? "Setting up…" : copy.action}
        <Icon name="bell" size={16} />
      </button>
      <div className="notification-device-help">
        <div>
          <strong>Android · Chrome / Samsung Internet</strong>
          <span>
            Install the OZMO CA from the phone setup page, reopen the secure
            link, then tap Enable and Allow. In Android Settings, allow that
            browser’s Lock screen notifications and set its battery use to
            Unrestricted / Don’t optimize.
          </span>
        </div>
        <div>
          <strong>iPhone / iPad</strong>
          <span>
            Install and fully trust the OZMO profile, then Safari → Share → Add
            to Home Screen → open OZMO → Enable.
          </span>
        </div>
        <div>
          <strong>Computer · Chrome / Firefox</strong>
          <span>
            Allow this site in the browser, then allow Chrome or Firefox in
            macOS System Settings or Windows Notification settings.
          </span>
        </div>
      </div>
      <div className="android-certificate-help">
        <div>
          <strong>New phone, tablet, or certificate problem?</strong>
          <span>
            Open the bilingual device setup page on that phone. It provides the
            correct Apple profile or Android CA before signing in.
          </span>
          <small>
            {deviceSetupLink} · Same normal office Wi-Fi, not Guest Wi-Fi
          </small>
        </div>
        <a
          className="button button-soft"
          href={deviceSetupLink}
          target="_blank"
          rel="noreferrer"
        >
          Open device setup
          <Icon name="arrow" size={16} />
        </a>
      </div>
    </section>
  );
}

function StaffSettingsPage({ report }: { report: DailyReport }) {
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Your settings"
        title="Device notifications"
        copy="Connect every phone or browser where you want to receive OZMO report reminders, session alerts and manager messages."
      />
      <BrowserNotificationSetupCard />
      <section className="content-card staff-schedule-card">
        <header>
          <span className="settings-icon"><Icon name="history" /></span>
          <div>
            <span className="eyebrow">Your effective schedule</span>
            <h2>Working time & report access</h2>
            <p>
              This combines the company schedule with any days off or personal
              schedule assigned to you by an administrator.
            </p>
          </div>
        </header>
        <div className="staff-schedule-facts">
          <div>
            <small>Working hours</small>
            <strong>
              {formatClock(report.effectiveWorkStart ?? "10:00")} —{" "}
              {formatClock(report.effectiveWorkEnd ?? "18:00")}
            </strong>
          </div>
          <div>
            <small>Report deadline</small>
            <strong>{formatClock(report.reportDeadline ?? "18:00")}</strong>
          </div>
          <div>
            <small>Working days</small>
            <strong>
              {formatWorkDays(report.effectiveWorkDays ?? [6, 0, 1, 2, 3])}
            </strong>
          </div>
        </div>
        <p className="staff-schedule-note">
          If your schedule or day off is incorrect, ask an administrator to
          update it from company Settings.
        </p>
      </section>
    </div>
  );
}

function HelpPage({
  onTutorial,
  report,
}: {
  onTutorial: () => void;
  report: DailyReport;
}) {
  const reportDeadline = formatClock(report.reportDeadline ?? "18:00");
  const workDays = formatWorkDays(
    report.effectiveWorkDays ?? [6, 0, 1, 2, 3],
  );
  const rules = [
    ["OBAY & ZEID", "New completed Reel = +1 Reel. Re-edit = no inventory change."],
    ["ABD & OBEID", "New completed Post/design = +1 Post. Revision or in-progress = no change."],
    ["ALAA & JAD", "Published Reel/Post = −1. Content draft = +1 Draft. Meetings and sessions = no finished content."],
    [
      "ALL STAFF",
      `Submit before ${reportDeadline} on your working days (${workDays}). Your reminders stop after submission.`,
    ],
  ];
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="Quick guide"
        title="How OZMO works"
        copy="The important rules in one friendly place. You can replay the guided tour whenever you need it."
        action={
          <button className="button button-primary" onClick={onTutorial}>
            <Icon name="spark" size={17} /> Replay tutorial
          </button>
        }
      />
      <section className="help-grid">
        {rules.map(([who, rule], index) => (
          <article className="content-card help-card" key={who}>
            <span className="help-number">0{index + 1}</span>
            <span className="eyebrow">{who}</span>
            <h2>{rule.split(" = ")[0]}</h2>
            <p>{rule}</p>
          </article>
        ))}
      </section>
      <BrowserNotificationSetupCard />
      <section className="rule-strip bilingual-strip">
        <Icon name="bell" />
        <div>
          <strong>Report reminder · تذكير بالتقرير</strong>
          <p>
            Please submit your daily report before {reportDeadline}. · يرجى إرسال
            تقريرك اليومي قبل الموعد المحدد.
          </p>
        </div>
      </section>
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  copy,
  action,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      {action}
    </header>
  );
}

function AppShell({
  user,
  section,
  onSection,
  workStart,
  workEnd,
  notifications,
  notificationOpen,
  onNotificationToggle,
  onRefresh,
  onLogout,
  children,
}: {
  user: User;
  section: AppSection;
  onSection: (section: AppSection) => void;
  workStart: string;
  workEnd: string;
  notifications: NotificationItem[];
  notificationOpen: boolean;
  onNotificationToggle: () => void;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
  children: ReactNode;
}) {
  const [mobileNav, setMobileNav] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const isAdmin = user.role === "admin";
  const nav = isAdmin
    ? [
        ["home", "Overview", "home"],
        ["reports", "Reports", "activity"],
        ["inventory", "Inventory", "box"],
        ["clients", "Clients", "clients"],
        ["sessions", "Sessions", "calendar"],
        ["archive", "Month archive", "history"],
        ["team", "Team", "team"],
        ["activity", "Activity log", "activity"],
        ["settings", "Settings", "settings"],
      ]
    : [
        ["home", "Today’s report", "home"],
        ...(user.role === "account_manager" || user.role === "editor"
          ? ([["inventory", "Inventory", "box"]] as string[][])
          : []),
        ["history", "My history", "history"],
        ...(user.role === "account_manager" || user.role === "editor"
          ? ([["sessions", "Sessions", "calendar"]] as string[][])
          : []),
        ["settings", "Notifications", "settings"],
        ["help", "Help & rules", "help"],
      ];
  const unread = notifications.filter((item) => !item.read).length;

  async function refreshWorkspace() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <div className="sidebar-top">
          <Brand />
          <button
            className="mobile-close"
            onClick={() => setMobileNav(false)}
            aria-label="Close navigation"
          >
            <Icon name="close" />
          </button>
        </div>
        <nav>
          <span className="nav-label">{isAdmin ? "Management" : "Workspace"}</span>
          {nav.map(([value, label, icon]) => (
            <button
              key={value}
              className={section === value ? "active" : ""}
              onClick={() => {
                onSection(value as AppSection);
                setMobileNav(false);
              }}
            >
              <Icon name={icon as Parameters<typeof Icon>[0]["name"]} />
              <span>{label}</span>
              {section === value && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-office">
          <span className="office-pulse" />
          <div>
            <strong>Office network</strong>
            <small>Private access active</small>
          </div>
        </div>
        <div className="sidebar-user">
          <span className={`avatar avatar-${user.role}`}>{initials(user.displayName)}</span>
          <div>
            <strong>{user.displayName}</strong>
            <small>{ROLE_LABELS[user.role]}</small>
          </div>
          <button onClick={onLogout} aria-label="Sign out">
            <Icon name="logout" size={18} />
          </button>
        </div>
      </aside>
      {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} />}
      <main className="workspace">
        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={() => setMobileNav(true)}
            aria-label="Open navigation"
          >
            <Icon name="menu" />
          </button>
          <div>
            <strong>{isAdmin ? "OZMO Control Center" : `Hello, ${user.displayName}`}</strong>
            <span>{new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Damascus" }).format(new Date())}</span>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className={`topbar-refresh ${refreshing ? "is-refreshing" : ""}`}
              onClick={refreshWorkspace}
              disabled={refreshing}
              aria-label="Refresh all OZMO data"
              title="Refresh all data"
            >
              <Icon name="refresh" size={17} />
              <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
            </button>
            <span className="work-hours">
              {formatClock(workStart)} — {formatClock(workEnd)}
            </span>
            <button
              className="notification-button"
              onClick={onNotificationToggle}
              aria-label={
                unread > 0
                  ? `Open notifications, ${unread} unread`
                  : "Open notifications"
              }
            >
              <Icon name="bell" />
              {unread > 0 && <span>{unread > 9 ? "9+" : unread}</span>}
            </button>
          </div>
        </header>
        <div className="workspace-content">{children}</div>
      </main>
      <NotificationCenter
        open={notificationOpen}
        notifications={notifications}
        onClose={onNotificationToggle}
        onReadAll={async () => {
          await api("/api/notifications", {
            method: "PATCH",
            body: JSON.stringify({ all: true }),
          });
        }}
      />
    </div>
  );
}

export default function OzmoApp() {
  const [phase, setPhase] = useState<"loading" | "setup" | "login" | "app">("loading");
  const [user, setUser] = useState<User | null>(null);
  const [section, setSection] = useState<AppSection>("home");
  const [clients, setClients] = useState<Client[]>([]);
  const [report, setReport] = useState<DailyReport>({
    reportDate: todayInDamascus(),
    status: "not_started",
    isLocked: true,
    lockReason: "loading",
    tasks: [],
  });
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [archives, setArchives] = useState<MonthArchive[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [dataError, setDataError] = useState("");
  const shownNotifications = useRef(new Set<string>());

  const loadSession = useCallback(async () => {
    const setup = await api<{ setupRequired: boolean }>("/api/setup/status");
    if (setup.setupRequired) {
      setUser(null);
      setPhase("setup");
      return;
    }
    try {
      const result = await api<{ user: User }>("/api/auth/me");
      if (result.user.role !== "admin") {
        const reportResult = await api<{ report: DailyReport }>("/api/reports");
        setReport(reportResult.report);
        if (!result.user.tutorialCompleted) {
          setTutorialOpen(true);
        }
      }
      setUser(result.user);
      setPhase("app");
    } catch {
      setUser(null);
      setPhase("login");
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const result = await api<{
        notifications: Array<
          Partial<NotificationItem> & {
            id: string | number;
            kind?: string;
            messageEn?: string;
            messageAr?: string;
            readAt?: string | null;
          }
        >;
      }>("/api/notifications");
      const normalized = result.notifications.map((item) => ({
        id: String(item.id),
        type: item.type ?? item.kind ?? "update",
        titleEn: item.titleEn ?? "OZMO update",
        titleAr: item.titleAr ?? "تحديث OZMO",
        bodyEn: item.bodyEn ?? item.messageEn ?? "",
        bodyAr: item.bodyAr ?? item.messageAr ?? "",
        read: item.read ?? Boolean(item.readAt),
        createdAt: item.createdAt ?? new Date().toISOString(),
      }));
      setNotifications(normalized);
      if ("Notification" in window && Notification.permission === "granted") {
        const pushStatus = await getBrowserNotificationStatus();
        if (pushStatus.issue === "ready") return;

        normalized
          .filter((item) => !item.read && !shownNotifications.current.has(item.id))
          .forEach((item) => {
            shownNotifications.current.add(item.id);
            void showBrowserNotification({
              title: item.titleEn,
              body: `${item.bodyEn}\n${item.bodyAr}`,
              tag: item.id,
            }).catch(() => {
              shownNotifications.current.delete(item.id);
            });
          });
      }
    } catch {
      // The in-app center will retry quietly on the next polling cycle.
    }
  }, [user]);

  const loadData = useCallback(async () => {
    if (!user) return;
    setDataError("");
    try {
      const commonRequests = [
        api<{ clients: Client[] }>("/api/clients"),
        api<{ sessions: SessionItem[] }>("/api/sessions"),
        api<{ history: HistoryItem[] }>("/api/history"),
      ] as const;
      const [clientResult, rawSessionResult, historyResult] = await Promise.all(commonRequests);
      setClients(clientResult.clients);
      const sessionResult = rawSessionResult as {
        sessions: Array<
          Partial<SessionItem> & {
            id: string | number;
            clientId: string | number;
            clientName: string;
            scheduledFor?: string;
            createdByName?: string;
          }
        >;
      };
      setSessions(
        sessionResult.sessions.map((item) => ({
          id: String(item.id),
          clientId: String(item.clientId),
          clientName: item.clientName,
          scheduledAt: item.scheduledAt ?? item.scheduledFor ?? "",
          status: item.status ?? "scheduled",
          notes: item.notes ?? "",
          reelsShot:
            item.reelsShot == null ? null : Number(item.reelsShot),
          createdByName: item.createdByName,
        })),
      );
      setHistory(historyResult.history);
      if (user.role === "admin") {
        const [dashboardResult, usersResult, settingsResult, archiveResult] = await Promise.all([
          api<{ dashboard: DashboardData }>("/api/dashboard"),
          api<{ users: User[] }>("/api/admin/users"),
          api<{ settings: SettingsData }>("/api/settings"),
          api<{ archives: MonthArchive[] }>("/api/admin/archives"),
        ]);
        setDashboard(dashboardResult.dashboard);
        setUsers(usersResult.users);
        setSettings(settingsResult.settings);
        setArchives(archiveResult.archives);
      } else {
        const reportResult = await api<{ report: DailyReport }>("/api/reports");
        setReport(reportResult.report);
      }
    } catch (loadError) {
      setDataError((loadError as Error).message);
    }
  }, [user]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!user) return;
    void loadData();
    void loadNotifications();
  }, [user, loadData, loadNotifications]);

  useEffect(() => {
    if (!user) return;
    if ("serviceWorker" in navigator && window.isSecureContext) {
      void getOzmoServiceWorker().catch(() => undefined);
      if (
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        void reconcileBrowserPushSubscription().catch(() => undefined);
      }
    }
    const refreshVisibleWorkspace = () => {
      if (document.visibilityState === "visible") {
        void loadData();
        void loadNotifications();
      }
    };
    const timer = window.setInterval(refreshVisibleWorkspace, 30_000);
    window.addEventListener("focus", refreshVisibleWorkspace);
    document.addEventListener("visibilitychange", refreshVisibleWorkspace);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisibleWorkspace);
      document.removeEventListener("visibilitychange", refreshVisibleWorkspace);
    };
  }, [user, loadData, loadNotifications]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    setUser(null);
    setReport({
      reportDate: todayInDamascus(),
      status: "not_started",
      isLocked: true,
      lockReason: "loading",
      tasks: [],
    });
    setTutorialOpen(false);
    setPhase("login");
    setSection("home");
  }

  async function completeTutorial() {
    await api("/api/profile/tutorial", { method: "POST", body: "{}" });
    if (user) setUser({ ...user, tutorialCompleted: true });
  }

  const refreshAll = useCallback(async () => {
    await Promise.all([loadSession(), loadData(), loadNotifications()]);
  }, [loadSession, loadData, loadNotifications]);

  const page = useMemo(() => {
    if (!user) return null;
    if (user.role === "admin") {
      if (section === "home" && dashboard) {
        return <AdminDashboard data={dashboard} onNavigate={setSection} />;
      }
      if (section === "reports") {
        return <AdminReportsPage clients={clients} />;
      }
      if (section === "inventory") {
        return <InventoryPage clients={clients} onChanged={loadData} />;
      }
      if (section === "clients") {
        return (
          <ClientsPage
            clients={clients}
            history={history}
            onChanged={loadData}
          />
        );
      }
      if (section === "sessions") {
        return <SessionsPage user={user} clients={clients} sessions={sessions} onChanged={loadData} />;
      }
      if (section === "archive") {
        return (
          <MonthArchivePage
            clients={clients}
            archives={archives}
            onChanged={loadData}
          />
        );
      }
      if (section === "team") {
        return (
          <TeamPage
            currentUser={user}
            users={users}
            onChanged={refreshAll}
          />
        );
      }
      if (section === "activity") {
        return <HistoryPage items={history} onChanged={loadData} />;
      }
      if (section === "settings" && settings) {
        return <SettingsPage settings={settings} onChanged={loadData} />;
      }
    } else {
      if (section === "home") {
        return (
          <StaffReport
            user={user}
            clients={clients}
            sessions={sessions}
            report={report}
            onRefresh={loadData}
          />
        );
      }
      if (section === "history") return <HistoryPage items={history} ownOnly />;
      if (
        section === "inventory" &&
        (user.role === "account_manager" || user.role === "editor")
      ) {
        return (
          <InventoryPage
            clients={clients}
            onChanged={loadData}
            canAdjust={false}
            reelsOnly={user.role === "editor"}
          />
        );
      }
      if (section === "sessions") {
        return <SessionsPage user={user} clients={clients} sessions={sessions} onChanged={loadData} />;
      }
      if (section === "settings") {
        return <StaffSettingsPage report={report} />;
      }
      if (section === "help") {
        return (
          <HelpPage
            report={report}
            onTutorial={() => setTutorialOpen(true)}
          />
        );
      }
    }
    return <LoadingScreen />;
  }, [
    user,
    section,
    dashboard,
    clients,
    sessions,
    report,
    history,
    archives,
    users,
    settings,
    loadData,
    refreshAll,
  ]);

  if (phase === "loading") return <LoadingScreen />;
  if (phase === "setup") return <SetupScreen onReady={loadSession} />;
  if (phase === "login") return <LoginScreen onLogin={loadSession} />;
  if (!user) return <LoginScreen onLogin={loadSession} />;

  return (
    <AppShell
      user={user}
      section={section}
      onSection={setSection}
      workStart={
        user.role === "admin"
          ? settings?.workStart ?? "10:00"
          : report.effectiveWorkStart ?? "10:00"
      }
      workEnd={
        user.role === "admin"
          ? settings?.workEnd ?? "18:00"
          : report.effectiveWorkEnd ?? "18:00"
      }
      notifications={notifications}
      notificationOpen={notificationOpen}
      onNotificationToggle={() => {
        setNotificationOpen((value) => !value);
        if (!notificationOpen && notifications.some((item) => !item.read)) {
          void api("/api/notifications", {
            method: "PATCH",
            body: JSON.stringify({ all: true }),
          }).then(loadNotifications);
        }
      }}
      onRefresh={refreshAll}
      onLogout={logout}
    >
      {dataError && (
        <div className="workspace-error">
          <strong>Couldn’t refresh the latest data.</strong>
          <span>{dataError}</span>
          <button onClick={loadData}>Try again</button>
        </div>
      )}
      {page}
      {tutorialOpen && (
        <Tutorial
          user={user}
          report={report}
          onComplete={completeTutorial}
          onClose={() => setTutorialOpen(false)}
        />
      )}
    </AppShell>
  );
}
