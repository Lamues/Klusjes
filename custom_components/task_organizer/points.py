"""Whole-number point handling for the TaskOrganizer integration.

Points are always awarded in whole numbers. When a task is shared, the points
are divided with the "largest remainder" method so that nothing is lost or
invented: 5 points between two people becomes 3 + 2, never 2.5 + 2.5.
"""
from __future__ import annotations

_EPSILON = 1e-9


def allocate_whole_points(total: int, percentages: dict[str, float]) -> dict[str, int]:
    """
    Turn percentages into whole points.

    The sum of the awarded points equals the percentages' share of ``total``
    (so a distribution that deliberately gives out less than 100% stays below
    ``total``). Users that end up with 0 points are left out.

    Ties on the remainder go to the user that comes first in ``percentages``.
    """
    shares = {uid: float(pct) for uid, pct in percentages.items() if pct and float(pct) > 0}
    if not shares or total <= 0:
        return {}

    raw = {uid: pct / 100.0 * total for uid, pct in shares.items()}
    target = int(round(sum(raw.values()) + _EPSILON))
    points = {uid: int(value + _EPSILON) for uid, value in raw.items()}

    missing = target - sum(points.values())
    order = sorted(raw, key=lambda uid: -(raw[uid] - points[uid]))  # stable: ties keep input order
    for uid in order:
        if missing <= 0:
            break
        points[uid] += 1
        missing -= 1

    return {uid: pts for uid, pts in points.items() if pts > 0}


def split_equally(total: int, user_ids: list[str]) -> dict[str, int]:
    """Divide ``total`` points over the users in whole numbers (the first users get the extra point)."""
    unique = list(dict.fromkeys(user_ids))
    if not unique:
        return {}
    return allocate_whole_points(total, {uid: 100.0 / len(unique) for uid in unique})
