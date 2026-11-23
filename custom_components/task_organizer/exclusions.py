"""Users that can never be awarded points (e.g. shared wall tablets)."""
from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

# Hard-coded on purpose. Compared case-insensitively with the Home Assistant
# user name and with the name of the linked person. Keep in sync with
# www/utils/assignees.js.
EXCLUDED_POINT_USER_NAMES = {"echo 8", "echo 5"}


def _normalize(name: object) -> str:
    return str(name or "").strip().casefold()


async def async_get_excluded_user_ids(hass: HomeAssistant) -> set[str]:
    """Return the user IDs that must never receive points."""
    excluded: set[str] = set()

    for state in hass.states.async_all("person"):
        user_id = state.attributes.get("user_id")
        if user_id and _normalize(state.attributes.get("friendly_name")) in EXCLUDED_POINT_USER_NAMES:
            excluded.add(user_id)

    try:
        for user in await hass.auth.async_get_users():
            if _normalize(user.name) in EXCLUDED_POINT_USER_NAMES:
                excluded.add(user.id)
    except Exception as err:  # pragma: no cover - never block a completion on this
        _LOGGER.debug("Could not look up users for the points exclusion: %s", err)

    return excluded
