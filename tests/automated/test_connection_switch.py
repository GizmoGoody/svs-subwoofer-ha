"""Tests for the Connection switch."""

from __future__ import annotations

from homeassistant.core import HomeAssistant

from .conftest import FakeSubwoofer, SetupEntry, entity_id, settle
from .features import requires

pytestmark = requires("connection_switch")


async def _switch(hass: HomeAssistant, service: str) -> None:
    await hass.services.async_call(
        "switch",
        service,
        {"entity_id": entity_id(hass, "switch", "connection")},
        blocking=True,
    )
    await settle()


async def test_connection_switch_follows_the_connection(
    hass: HomeAssistant, sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """The switch is on while connected and turns the connection on and off."""
    await setup_entry()
    switch = entity_id(hass, "switch", "connection")
    assert hass.states.get(switch).state == "on"

    await _switch(hass, "turn_off")
    assert not sub.client.is_connected
    assert hass.states.get(switch).state == "off"

    connects = sub.connects
    await _switch(hass, "turn_on")
    assert sub.connects == connects + 1
    assert sub.client.is_connected
    assert hass.states.get(switch).state == "on"
