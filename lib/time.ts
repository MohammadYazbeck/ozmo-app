const TIME_ZONE = "Asia/Damascus";

export function damascusDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function damascusClock(now = new Date()): {
  hour: number;
  minute: number;
  weekday: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    weekday: weekdays[value("weekday")] ?? new Date().getDay(),
  };
}

export function damascusMinutes(now = new Date()): number {
  const { hour, minute } = damascusClock(now);
  return hour * 60 + minute;
}

export function localDamascusDateTimeToIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("Choose a valid session date and time.");
  }
  // Syria has observed permanent UTC+03:00 since late 2022. Keeping the
  // explicit offset prevents the office computer's own timezone from changing
  // the scheduled time.
  const date = new Date(`${value}:00+03:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Choose a valid session date and time.");
  }
  return date.toISOString();
}

export function isoWeekDates(end = new Date(), days = 7): string[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - (days - 1 - index));
    return damascusDate(date);
  });
}

export function isAfterDeadline(
  now: Date,
  deadline: string,
): boolean {
  const [hour, minute] = deadline.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  return damascusMinutes(now) >= hour * 60 + minute;
}
