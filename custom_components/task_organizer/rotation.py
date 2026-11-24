"""Assignee rotation helpers for the TaskOrganizer integration.

A task can have several assignees (the "pool"). When it has two or more, only
ONE of them is responsible per cycle. Two optional keys are stored on the task:

- ``current_assignee``: who was responsible for the current cycle.
- ``next_assignee``:    who takes over as soon as the task becomes due again.

The person shown/used is derived on the fly (no timers needed):
``next_assignee`` once the due date has been reached, otherwise
``current_assignee``. Without any stored state the first person in the pool is
used.
"""
from __future__ import annotations

from typing import Any

from homeassistant.util import dt as dt_util

# Tolerance for floating point rounding when comparing points.
_EPSILON = 1e-9


def _pool(task: dict[str, Any]) -> list[str]:
    """Return the list of assignee user IDs of a task."""
    pool = task.get("assignees") or []
    if isinstance(pool, str):
        pool = [pool]
    return [uid for uid in pool if uid]


def _is_due(task: dict[str, Any]) -> bool:
    """Return True if the due date (local calendar day) is today or in the past."""
    try:
        parsed = dt_util.parse_datetime(task.get("due_date") or "")
    except (ValueError, TypeError):
        return False
    if parsed is None:
        return False
    return dt_util.as_local(parsed).date() <= dt_util.now().date()


def get_effective_assignees(task: dict[str, Any]) -> list[str]:
    """
    Return who is currently responsible for a task.

    With fewer than two assignees this is simply the assignee list. With two or
    more it is a list containing exactly one user ID.
    """
    pool = _pool(task)
    if len(pool) < 2:
        return pool

    current = task.get("current_assignee")
    upcoming = task.get("next_assignee")

    if upcoming in pool and _is_due(task):
        who = upcoming
    elif current in pool:
        who = current
    else:
        who = pool[0]
    return [who]


def advance_assignee(
    task: dict[str, Any],
    users_with_points: dict[str, float],
    total_points: float,
) -> bool:
    """
    Decide who is responsible for the next cycle. Call this BEFORE the due date
    of the task is moved forward.

    Rotation: the responsible person is followed by the next one in the pool.
    Hold: if somebody else than the responsible person was awarded MORE than
    half of the available points, the responsible person is assumed not to have
    (fully) done the task and stays assigned for the next cycle.

    :return: True if the rotation was halted, otherwise False.
    """
    pool = _pool(task)
    if len(pool) < 2:
        task.pop("current_assignee", None)
        task.pop("next_assignee", None)
        return False

    responsible = get_effective_assignees(task)[0]
    half = float(total_points) / 2

    took_over = any(
        uid != responsible and (pts - half) > _EPSILON
        for uid, pts in users_with_points.items()
    )

    task["current_assignee"] = responsible
    if took_over:
        task["next_assignee"] = responsible
    else:
        task["next_assignee"] = pool[(pool.index(responsible) + 1) % len(pool)]
    return took_over


def set_current_assignee(task: dict[str, Any], user_id: str | None) -> bool:
    """
    Make ``user_id`` the person who is responsible right now.

    Works only for tasks with two or more assignees and a user from that pool.
    The rotation continues from this person. Returns True if something changed.
    """
    pool = _pool(task)
    if len(pool) < 2 or not user_id or user_id not in pool:
        return False
    if get_effective_assignees(task)[0] == user_id:
        return False
    task["current_assignee"] = user_id
    task["next_assignee"] = user_id
    return True
