"""Tests for reading the preset names when a reply is lost."""

from __future__ import annotations

from homeassistant.core import HomeAssistant

from .conftest import FakeSubwoofer, SetupEntry, entity_id, settle
from .features import requires

pytestmark = requires("preset_name_retry")


def _options(hass: HomeAssistant) -> list[str]:
    return hass.states.get(entity_id(hass, "select", "preset")).attributes["options"]


async def test_lost_name_reply_is_asked_for_again(
    hass: HomeAssistant, sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """A name the sub did not send is asked for again, and then shown."""
    sub.lose_names = {2: 1}
    await setup_entry()
    await settle(2.0)
    assert _options(hass)[:3] == ["HIGH", "MEDIUM", "LOW"]


async def test_names_received_are_not_asked_for_again(
    hass: HomeAssistant, sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """With every name received, nothing more is sent."""
    await setup_entry()
    sent = len(sub.received)
    await settle(2.0)
    assert len(sub.received) == sent
    assert _options(hass)[:3] == ["HIGH", "MEDIUM", "LOW"]
