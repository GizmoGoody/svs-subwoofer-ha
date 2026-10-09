"""Tests for a group's Connect and Disconnect buttons and Connection switch."""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.svs_subwoofer import subwoofer_group
from custom_components.svs_subwoofer.const import DOMAIN

from .conftest import ADDRESS, ADDRESS2, NAME2, FakeSubwoofer, SetupEntry, settle
from .features import requires

pytestmark = requires("group_connection")


@pytest.fixture(autouse=True)
def quick_retries():
    """Retry without the real waits."""
    with patch.object(subwoofer_group, "GROUP_RETRY_DELAY", 0.01):
        yield


async def _setup(hass: HomeAssistant, setup_entry: SetupEntry) -> MockConfigEntry:
    await setup_entry()
    await setup_entry(address=ADDRESS2, name=NAME2)
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Both Subs",
        data={"entry_type": "group"},
        options={
            "members": [ADDRESS, ADDRESS2],
            "features": ["preset", "standby", "volume"],
            "volume_mode": "matched",
            "offsets": {},
        },
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await settle()
    return entry


def _entity(
    hass: HomeAssistant, entry: MockConfigEntry, platform: str, key: str
) -> str:
    found = er.async_get(hass).async_get_entity_id(
        platform, DOMAIN, f"group_{entry.entry_id}_{key}"
    )
    assert found, f"No group {platform} {key}"
    return found


async def _call(hass: HomeAssistant, domain: str, service: str, entity: str) -> Any:
    await hass.services.async_call(
        domain, service, {"entity_id": entity}, blocking=True
    )
    await settle()


async def test_switch_disconnects_and_connects_every_member(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """The switch is on while all are connected, and acts on all of them."""
    entry = await _setup(hass, setup_entry)
    switch = _entity(hass, entry, "switch", "connection")
    assert hass.states.get(switch).state == "on"

    await _call(hass, "switch", "turn_off", switch)
    assert not sub.client.is_connected
    assert not second_sub.client.is_connected
    assert hass.states.get(switch).state == "off"

    await _call(hass, "switch", "turn_on", switch)
    assert sub.client.is_connected
    assert second_sub.client.is_connected
    assert hass.states.get(switch).state == "on"


async def test_buttons_disconnect_and_connect_every_member(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """Disconnect and Connect act on every member."""
    entry = await _setup(hass, setup_entry)
    await _call(hass, "button", "press", _entity(hass, entry, "button", "disconnect"))
    assert not sub.client.is_connected
    assert not second_sub.client.is_connected
    await _call(hass, "button", "press", _entity(hass, entry, "button", "connect"))
    assert sub.client.is_connected
    assert second_sub.client.is_connected


async def test_member_that_does_not_connect_is_tried_again(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """A member that refuses a connection is tried again until it connects."""
    entry = await _setup(hass, setup_entry)
    switch = _entity(hass, entry, "switch", "connection")
    await _call(hass, "switch", "turn_off", switch)
    second_sub.refuse_connects = 2
    await _call(hass, "switch", "turn_on", switch)
    assert sub.client.is_connected
    assert second_sub.client.is_connected
    assert hass.states.get(switch).state == "on"


async def test_member_that_never_connects_fails_by_name(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """After every try, the action fails naming the member it could not reach."""
    entry = await _setup(hass, setup_entry)
    switch = _entity(hass, entry, "switch", "connection")
    await _call(hass, "switch", "turn_off", switch)
    second_sub.refuse_connects = 100
    with pytest.raises(HomeAssistantError, match=NAME2):
        await _call(hass, "switch", "turn_on", switch)
    # The other member connected anyway
    assert sub.client.is_connected
    assert hass.states.get(switch).state == "off"
