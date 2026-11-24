/**
 * Fixed-calendar schedules (mirrors schedule.py).
 *
 *   { type: 'weekly',     weekdays: [0, 2] }      // 0 = Monday ... 6 = Sunday, one or more days
 *   { type: 'monthly',    day: 15 }
 *   { type: 'quarterly',  day: 15, month: 1 }     // month 1/2/3 of every quarter
 *   { type: 'halfyearly', day: 15, month: 2 }     // month 1..6 of every half year
 *   { type: 'yearly',     day: 15, month: 3 }
 *
 * A day that does not exist in a month (e.g. 31 in February) falls back to the
 * last day of that month.
 */

/** Local date as 'YYYY-MM-DD' (toISOString() would shift the day for time zones east of UTC). */
export function toYMD(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Weekdays of a weekly schedule (also understands the old single `weekday` key). */
export function weekdaysOf(schedule) {
  const days = Array.isArray(schedule.weekdays) ? schedule.weekdays : [schedule.weekday];
  return days.map(Number).filter(d => d >= 0 && d <= 6);
}

function monthMatches(schedule, month) {
  if (schedule.type === 'monthly') return true;
  if (schedule.type === 'quarterly') return (month - 1) % 3 === schedule.month - 1;
  if (schedule.type === 'halfyearly') return (month - 1) % 6 === schedule.month - 1;
  return month === schedule.month; // yearly
}

/**
 * First scheduled date after `after` (or on it when `inclusive`).
 * @param {object} schedule
 * @param {Date} after
 * @param {boolean} inclusive
 * @returns {Date|null} - Local date at midnight.
 */
export function nextOccurrence(schedule, after, inclusive = false) {
  const base = new Date(after.getFullYear(), after.getMonth(), after.getDate());

  if (schedule.type === 'weekly') {
    const weekday = (base.getDay() + 6) % 7; // Monday = 0
    const days = weekdaysOf(schedule);
    if (days.length === 0) return null;
    const delta = Math.min(...days.map(d => {
      const diff = (d - weekday + 7) % 7;
      return (diff === 0 && !inclusive) ? 7 : diff;
    }));
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
  }

  let year = base.getFullYear();
  let month = base.getMonth() + 1;
  for (let i = 0; i < 96; i++) {
    if (monthMatches(schedule, month)) {
      const lastDay = new Date(year, month, 0).getDate();
      const candidate = new Date(year, month - 1, Math.min(schedule.day, lastDay));
      if (candidate > base || (inclusive && candidate.getTime() === base.getTime())) return candidate;
    }
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return null;
}
