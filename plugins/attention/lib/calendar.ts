const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function splitMonth(month: string): { year: number; monthIndex: number } {
  const [year, monthNumber] = month.split("-").map(Number);
  return { year: year ?? 1970, monthIndex: (monthNumber ?? 1) - 1 };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function monthOf(day: string): string {
  return day.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const { year, monthIndex } = splitMonth(month);
  const shifted = new Date(Date.UTC(year, monthIndex + delta, 1));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
}

export function monthTitle(month: string): string {
  const { year, monthIndex } = splitMonth(month);
  return `${MONTHS[monthIndex] ?? ""} ${year}`;
}

export function weekdayLabels(): readonly string[] {
  return WEEKDAYS;
}

export function dayKey(month: string, dayOfMonth: number): string {
  return `${month}-${pad(dayOfMonth)}`;
}

export function monthGrid(month: string): Array<string | null> {
  const { year, monthIndex } = splitMonth(month);
  const firstWeekday =
    (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from(
    { length: firstWeekday },
    () => null,
  );
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(dayKey(month, day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function dayLabel(day: string): string {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(
    new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, dayOfMonth ?? 1)),
  );
}

export function addDays(day: string, delta: number): string {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  const next = new Date(
    Date.UTC(year ?? 1970, (month ?? 1) - 1, (dayOfMonth ?? 1) + delta),
  );
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(
    next.getUTCDate(),
  )}`;
}

export function weekRange(day: string): { startDay: string; endDay: string } {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  const weekday =
    (new Date(
      Date.UTC(year ?? 1970, (month ?? 1) - 1, dayOfMonth ?? 1),
    ).getUTCDay() +
      6) %
    7;
  const startDay = addDays(day, -weekday);
  return { startDay, endDay: addDays(startDay, 6) };
}

export function monthRange(day: string): { startDay: string; endDay: string } {
  const month = monthOf(day);
  const [year, monthNumber] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year ?? 1970, monthNumber ?? 1, 0));
  return {
    startDay: `${month}-01`,
    endDay: `${month}-${pad(last.getUTCDate())}`,
  };
}
