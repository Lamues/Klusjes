"""Fixed-calendar schedules for recurring tasks.

By default a recurring task becomes due again ``interval`` days after it was
completed. A task can optionally carry a ``schedule`` instead, which makes it
become due on fixed calendar days, no matter when it was completed:

    {"type": "weekly",     "weekdays": [0, 2]}         # 0 = Monday ... 6 = Sunday, one or more days
    {"type": "monthly",    "day": 15}                  # day of the month
    {"type": "quarterly",  "day": 15, "month": 1}      # month 1/2/3 of every quarter
    {"type": "halfyearly", "day": 15, "month": 2}      # month 1..6 of every half year
    {"type": "yearly",     "day": 15, "month": 3}      # month 1..12

Older versions stored a single ``"weekday": 0`` for weekly schedules. That is still
understood and converted to ``"weekdays": [0]``.

A day that does not exist in a month (e.g. 31 in February) falls back to the
last day of that month, so ``day: 31`` means "the last day of the month".

Due dates are stored at 12:00 local time so that the calendar day is the same
in UTC and in the local time zone (the sensors and the cards both rely on that).
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, time, timedelta
from typing import Any

from homeassistant.util import dt as dt_util

_MAX_MONTHS_SCANNED = 12 * 8


def _int_in_range(value: Any, low: int, high: int) -> int | None:
    """Return value as int if it lies within [low, high], otherwise None."""
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if low <= number <= high else None


def normalize_schedule(raw: Any) -> dict[str, Any] | None:
    """Validate a schedule coming from the UI. Returns None for 'no schedule'."""
    if not isinstance(raw, dict):
        return None

    kind = raw.get("type")
    if kind == "weekly":
        raw_days = raw.get("weekdays")
        if raw_days is None and raw.get("weekday") is not None:
            raw_days = [raw.get("weekday")]  # format of older versions
        if not isinstance(raw_days, (list, tuple, set)):
            return None
        days = sorted({d for d in (_int_in_range(x, 0, 6) for x in raw_days) if d is not None})
        return {"type": "weekly", "weekdays": days} if days else None

    day = _int_in_range(raw.get("day"), 1, 31)
    if day is None:
        return None
    if kind == "monthly":
        return {"type": "monthly", "day": day}
    if kind == "quarterly":
        month = _int_in_range(raw.get("month"), 1, 3)
        return None if month is None else {"type": "quarterly", "day": day, "month": month}
    if kind == "halfyearly":
        month = _int_in_range(raw.get("month"), 1, 6)
        return None if month is None else {"type": "halfyearly", "day": day, "month": month}
    if kind == "yearly":
        month = _int_in_range(raw.get("month"), 1, 12)
        return None if month is None else {"type": "yearly", "day": day, "month": month}
    return None


def _weekdays_of(schedule: dict[str, Any]) -> list[int]:
    """Weekdays of a weekly schedule (also understands the old single ``weekday`` key)."""
    days = schedule.get("weekdays")
    if days is None:
        days = [schedule["weekday"]]
    return sorted(days)


def describe_schedule(schedule: dict[str, Any] | None) -> str | None:
    """Short readable text for the edit history."""
    if not schedule:
        return None
    kind = schedule["type"]
    if kind == "weekly":
        return "weekly: " + ", ".join(calendar.day_name[d] for d in _weekdays_of(schedule))
    if kind == "monthly":
        return f"monthly: day {schedule['day']}"
    if kind == "quarterly":
        return f"quarterly: day {schedule['day']}, month {schedule['month']} of the quarter"
    if kind == "halfyearly":
        return f"every 6 months: day {schedule['day']}, month {schedule['month']} of the half year"
    return f"yearly: {calendar.month_name[schedule['month']]} {schedule['day']}"


def _month_matches(schedule: dict[str, Any], month: int) -> bool:
    kind = schedule["type"]
    if kind == "monthly":
        return True
    if kind == "quarterly":
        return (month - 1) % 3 == schedule["month"] - 1
    if kind == "halfyearly":
        return (month - 1) % 6 == schedule["month"] - 1
    return month == schedule["month"]  # yearly


def next_occurrence(schedule: dict[str, Any], after: date, inclusive: bool = False) -> date:
    """
    Return the first scheduled date after ``after`` (or on it if ``inclusive``).
    """
    if schedule["type"] == "weekly":
        deltas = []
        for weekday in _weekdays_of(schedule):
            delta = (weekday - after.weekday()) % 7
            if delta == 0 and not inclusive:
                delta = 7
            deltas.append(delta)
        return after + timedelta(days=min(deltas))

    year, month = after.year, after.month
    for _ in range(_MAX_MONTHS_SCANNED):
        if _month_matches(schedule, month):
            last_day = calendar.monthrange(year, month)[1]
            candidate = date(year, month, min(schedule["day"], last_day))
            if candidate > after or (inclusive and candidate == after):
                return candidate
        month += 1
        if month > 12:
            month, year = 1, year + 1
    raise ValueError(f"No occurrence found for schedule {schedule}")


def _due_iso(day: date) -> str:
    """ISO string (UTC) for 12:00 local time on the given day."""
    return dt_util.as_utc(datetime.combine(day, time(12, 0))).isoformat()


def date_string_to_due_iso(value: str) -> str | None:
    """Convert a 'YYYY-MM-DD' string from the UI into a stored due date."""
    try:
        return _due_iso(date.fromisoformat(value[:10]))
    except (TypeError, ValueError):
        return None


def first_due_iso(schedule: dict[str, Any]) -> str:
    """First due date for a new scheduled task: the next scheduled day, today included."""
    return _due_iso(next_occurrence(schedule, dt_util.now().date(), inclusive=True))


def _local_date(iso_value: Any) -> date | None:
    try:
        parsed = dt_util.parse_datetime(iso_value or "")
    except (ValueError, TypeError):
        return None
    return dt_util.as_local(parsed).date() if parsed else None


def compute_next_due(task: dict[str, Any]) -> str | None:
    """
    Next due date after a completion, or None if the task has no schedule
    (the caller then falls back to 'interval days from now').

    The new date is the first scheduled day after today. If the task was not
    due yet when it was completed (done ahead of time) the upcoming occurrence
    counts as done, so the first scheduled day after the current due date is
    used.
    """
    schedule = normalize_schedule(task.get("schedule"))
    if not schedule:
        return None

    base = dt_util.now().date()
    current_due = _local_date(task.get("due_date"))
    if current_due and current_due > base:
        base = current_due
    return _due_iso(next_occurrence(schedule, base, inclusive=False))
