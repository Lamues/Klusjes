"""Users that never take part: they cannot be assigned tasks and never receive points.

Chosen in the integration options ("excluded_users"), e.g. shared wall tablets.
"""
from __future__ import annotations

from homeassistant.core import HomeAssistant

from .const import DOMAIN

CONF_EXCLUDED_USERS = "excluded_users"


def get_excluded_user_ids(hass: HomeAssistant) -> set[str]:
    """Return the user IDs that are excluded in the options."""
    settings = (hass.data.get(DOMAIN, {}).get("data") or {}).get("settings") or {}
    value = settings.get(CONF_EXCLUDED_USERS) or []
    if isinstance(value, str):
        value = [value]
    return {str(uid) for uid in value if uid}


async def async_get_excluded_user_ids(hass: HomeAssistant) -> set[str]:
    """Async wrapper, kept so existing callers do not change."""
    return get_excluded_user_ids(hass)
