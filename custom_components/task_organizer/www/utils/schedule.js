/**
 * Fixed-calendar schedules (mirrors schedule.py).
 *
 *   { type: 'weekly',    weekday: 0 }            // 0 = Monday ... 6 = Sunday
 *   { type: 'monthly',   day: 15 }
 *   { type: 'quarterly', day: 15, month: 1 }     // month 1/2/3 of every quarter
 *   { type: 'yearly',    day: 15, month: 3 }
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

function monthMatches(schedule, month) {
  if (schedule.type === 'monthly') return true;
  if (schedule.type === 'quarterly') return (month - 1) % 3 === schedule.month - 1;
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
    let delta = (schedule.weekday - weekday + 7) % 7;
    if (delta === 0 && !inclusive) delta = 7;
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
