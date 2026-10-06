"""Tests for preset detection and the Manual state (PR 10)."""

from __future__ import annotations

from homeassistant.core import HomeAssistant

from .conftest import FakeSubwoofer, SetupEntry, entity_id, settle
from .features import requires

pytestmark = requires("preset_detection")


async def _select(hass: HomeAssistant, option: str) -> None:
    await hass.services.async_call(
        "select",
        "select_option",
        {"entity_id": entity_id(hass, "select", "preset"), "option": option},
        blocking=True,
    )
    await settle(1.0)


def _preset(hass: HomeAssistant) -> str:
    return hass.states.get(entity_id(hass, "select", "preset")).state


async def test_loaded_preset_is_shown(
    hass: HomeAssistant, sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """Loading a preset applies it on the sub and shows it."""
    await setup_entry()
    await _select(hass, "HIGH")
    assert sub.settings["VOLUME"] == -10
    assert _preset(hass) == "HIGH"


async def test_volume_change_shows_manual_and_it_sticks(
    hass: HomeAssistant, sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """A change made in HA shows Manual, even when it matches a preset again."""
    await setup_entry()
    await _select(hass, "MEDIUM")
    volume = entity_id(hass, "number", "volume")
    for value in (-14, -15):  # -15 is MEDIUM's volume again
        await hass.services.async_call(
            "number", "set_value", {"entity_id": volume, "value": value}, blocking=True
        )
        await settle()
        assert _preset(hass) == "Manual", value


async def test_selecting_manual_sends_nothing(
    hass: HomeAssistant, sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """Choosing Manual marks the settings as manual without writing to the sub."""
    await setup_entry()
    await _select(hass, "MEDIUM")
    frames_before = len(sub.received)
    await _select(hass, "Manual")
    assert _preset(hass) == "Manual"
    assert [t for t in sub.frame_types()[frames_before:] if t != "f11f"] == []


async def test_loading_a_preset_clears_manual(
    hass: HomeAssistant, sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """Manual lasts until a preset is loaded."""
    await setup_entry()
    await _select(hass, "MEDIUM")
    await _select(hass, "Manual")
    await _select(hass, "LOW")
    assert _preset(hass) == "LOW"


async def test_preset_loaded_outside_ha_is_recognized(
    hass: HomeAssistant, sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """After HA has recorded a preset, it is recognized when loaded elsewhere."""
    entry = await setup_entry()
    await _select(hass, "LOW")
    await _select(hass, "MEDIUM")
    # Load LOW behind HA's back (for example from the SVS app), then reconnect
    sub.settings["VOLUME"] = -20
    assert await hass.config_entries.async_reload(entry.entry_id)
    await settle(1.0)
    assert _preset(hass) == "LOW"


@requires("quiet_preset_load")
async def test_preset_load_sends_only_the_load_command(
    hass: HomeAssistant, sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """A load relies on the sub's own reply instead of extra requests."""
    await setup_entry()
    frames_before = len(sub.received)
    await _select(hass, "HIGH")
    assert sub.frame_types()[frames_before:] == ["0704"]
