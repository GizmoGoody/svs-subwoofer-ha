"""Tests for subwoofer groups: one device that controls several subwoofers."""

from __future__ import annotations

from typing import Any

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr, entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.svs_subwoofer import device_trigger
from custom_components.svs_subwoofer.const import DOMAIN

from .conftest import (
    ADDRESS,
    ADDRESS2,
    NAME,
    NAME2,
    FakeSubwoofer,
    SetupEntry,
    entity_id,
    settle,
)
from .features import requires

pytestmark = requires("groups")

ALL_FEATURES = ["preset", "standby", "volume"]


async def _setup_subs(setup_entry: SetupEntry) -> None:
    await setup_entry()
    await setup_entry(address=ADDRESS2, name=NAME2)


async def _setup_group(hass: HomeAssistant, **options: Any) -> MockConfigEntry:
    """Add a group of both subwoofers; options override the defaults."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Both Subs",
        data={"entry_type": "group"},
        options={
            "members": [ADDRESS, ADDRESS2],
            "features": ALL_FEATURES,
            "volume_mode": "matched",
            "synced_members": [ADDRESS, ADDRESS2],
            "offsets": {},
        }
        | options,
    )
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await settle()
    return entry


def _group_entity(
    hass: HomeAssistant, entry: MockConfigEntry, platform: str, key: str
) -> str | None:
    return er.async_get(hass).async_get_entity_id(
        platform, DOMAIN, f"group_{entry.entry_id}_{key}"
    )


def _state(hass: HomeAssistant, entity: str | None) -> str:
    assert entity
    return hass.states.get(entity).state


async def _call(
    hass: HomeAssistant, domain: str, entity: str | None, **data: Any
) -> None:
    service = "select_option" if domain == "select" else "set_value"
    await hass.services.async_call(
        domain, service, {"entity_id": entity, **data}, blocking=True
    )
    await settle(1.0)


def _loaded_slots(sub: FakeSubwoofer) -> list[int]:
    """Return the preset slots the sub was told to load, in order."""
    return [
        int.from_bytes(frame[5:9], "little") - 0x17
        for frame in sub.received
        if frame[1:3] == b"\x07\x04" and 0x18 <= frame[5] <= 0x1B
    ]


# The setup flow


async def test_menu_offers_groups_with_two_subwoofers(
    hass: HomeAssistant, second_sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """With two subwoofers added, the setup flow offers to create a group."""
    await _setup_subs(setup_entry)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.MENU
    assert result["menu_options"] == ["add_subwoofer", "create_group"]


async def test_create_group_needs_two_members(
    hass: HomeAssistant, second_sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """A group of one subwoofer is refused; two make a group."""
    await _setup_subs(setup_entry)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "create_group"}
    )
    assert result["step_id"] == "create_group"
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {"name": "Both Subs", "members": [ADDRESS], "features": ["preset"]},
    )
    assert result["errors"] == {"members": "too_few_members"}
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {"name": "Both Subs", "members": [ADDRESS, ADDRESS2], "features": ["preset"]},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Both Subs"
    assert result["data"] == {"entry_type": "group"}
    assert result["options"]["members"] == [ADDRESS, ADDRESS2]
    await settle()


async def test_create_group_with_offsets(
    hass: HomeAssistant, second_sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """Offset mode asks for each synced subwoofer's offset, by name."""
    await _setup_subs(setup_entry)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "create_group"}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {"name": "Both Subs", "members": [ADDRESS, ADDRESS2], "features": ALL_FEATURES},
    )
    assert result["step_id"] == "group_volume"
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {"volume_mode": "offset", "synced_members": [ADDRESS, ADDRESS2]},
    )
    assert result["step_id"] == "group_offsets"
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {NAME: 3, NAME2: 0}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["options"]["volume_mode"] == "offset"
    assert result["options"]["offsets"] == {ADDRESS: 3, ADDRESS2: 0}
    await settle()


async def test_options_flow_changes_features(
    hass: HomeAssistant, second_sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """Leaving Volume out of the group removes its volume control."""
    await _setup_subs(setup_entry)
    entry = await _setup_group(hass)
    assert _group_entity(hass, entry, "number", "volume")
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["step_id"] == "group_members"
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {"members": [ADDRESS, ADDRESS2], "features": ["preset", "standby"]},
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await settle()
    assert entry.options["features"] == ["preset", "standby"]
    # The reloaded group no longer provides it
    volume = _group_entity(hass, entry, "number", "volume")
    assert volume
    assert _state(hass, volume) == "unavailable"


# Presets


async def test_presets_are_matched_by_name(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """A preset name loads each sub's own slot; unmatched names are left out."""
    # Sub 1: HIGH, MEDIUM, LOW. Sub 2: LOW, high, BASS
    second_sub.preset_names = ["LOW", "high", "BASS"]
    await _setup_subs(setup_entry)
    entry = await _setup_group(hass)
    preset = _group_entity(hass, entry, "select", "preset")
    options = hass.states.get(preset).attributes["options"]
    assert options == ["HIGH", "LOW", "Default", "Manual", "Mixed"]

    await _call(hass, "select", preset, option="LOW")
    assert _loaded_slots(sub)[-1] == 3
    assert _loaded_slots(second_sub)[-1] == 1
    assert _state(hass, preset) == "LOW"

    await _call(hass, "select", preset, option="HIGH")
    assert _loaded_slots(sub)[-1] == 1
    assert _loaded_slots(second_sub)[-1] == 2
    assert _state(hass, preset) == "HIGH"


async def test_preset_shows_mixed_and_manual(
    hass: HomeAssistant, second_sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """Mixed when the subs differ; Manual only when every sub is Manual."""
    await _setup_subs(setup_entry)
    entry = await _setup_group(hass)
    preset = _group_entity(hass, entry, "select", "preset")
    await _call(hass, "select", preset, option="HIGH")
    assert _state(hass, preset) == "HIGH"

    # Changing one sub on its own does not change the other
    await _call(hass, "select", entity_id(hass, "select", "preset"), option="LOW")
    assert _state(hass, preset) == "Mixed"
    assert _state(hass, entity_id(hass, "select", "preset", ADDRESS2)) == "HIGH"

    await _call(hass, "select", preset, option="Manual")
    assert _state(hass, preset) == "Manual"


# Standby


async def test_standby_is_set_on_every_sub(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """The group standby mode is set on both subs and shows Mixed when they differ."""
    await _setup_subs(setup_entry)
    entry = await _setup_group(hass)
    standby = _group_entity(hass, entry, "select", "standby_mode")
    assert _state(hass, standby) == "ON"

    await _call(hass, "select", standby, option="Auto ON")
    assert sub.settings["STANDBY"] == 0
    assert second_sub.settings["STANDBY"] == 0
    assert _state(hass, standby) == "Auto ON"

    await _call(
        hass, "select", entity_id(hass, "select", "standby_mode"), option="Trigger"
    )
    assert _state(hass, standby) == "Mixed"


# Volume


async def test_matched_volume(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """Every synced sub follows the group volume until all were changed alone."""
    await _setup_subs(setup_entry)
    entry = await _setup_group(hass)
    volume = _group_entity(hass, entry, "number", "volume")
    # Both subs start at -15
    assert float(_state(hass, volume)) == -15

    await _call(hass, "number", volume, value=-30)
    assert sub.settings["VOLUME"] == -30
    assert second_sub.settings["VOLUME"] == -30
    assert float(_state(hass, volume)) == -30

    # One sub changed on its own: the other is still at the group volume
    await _call(hass, "number", entity_id(hass, "number", "volume"), value=-25)
    assert float(_state(hass, volume)) == -30
    # Both changed on their own to different levels: no group volume
    await _call(
        hass, "number", entity_id(hass, "number", "volume", ADDRESS2), value=-28
    )
    assert _state(hass, volume) == "unknown"

    # Setting the group again brings both back
    await _call(hass, "number", volume, value=-20)
    assert sub.settings["VOLUME"] == second_sub.settings["VOLUME"] == -20


async def test_volume_follows_a_preset_load(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """After a preset load, the volume the subs share is the group volume."""
    await _setup_subs(setup_entry)
    entry = await _setup_group(hass)
    volume = _group_entity(hass, entry, "number", "volume")
    await _call(hass, "number", volume, value=-30)

    # LOW is -20 dB on both subs
    preset = _group_entity(hass, entry, "select", "preset")
    await _call(hass, "select", preset, option="LOW")
    assert float(_state(hass, volume)) == -20

    # It is remembered: one sub changed on its own does not change the group
    await _call(hass, "number", entity_id(hass, "number", "volume"), value=-25)
    assert float(_state(hass, volume)) == -20


async def test_offset_volume(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """Each sub plays at the group volume plus its offset."""
    await _setup_subs(setup_entry)
    entry = await _setup_group(
        hass, volume_mode="offset", offsets={ADDRESS: -2, ADDRESS2: 2}
    )
    volume = _group_entity(hass, entry, "number", "volume")

    await _call(hass, "number", volume, value=-9)
    assert sub.settings["VOLUME"] == -11
    assert second_sub.settings["VOLUME"] == -7
    assert float(_state(hass, volume)) == -9

    # Sub 2 would go above 0: nothing changes
    await _call(hass, "number", volume, value=-1)
    assert sub.settings["VOLUME"] == -11
    assert second_sub.settings["VOLUME"] == -7
    assert float(_state(hass, volume)) == -9


async def test_unsynced_sub_keeps_its_volume(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """With fewer than two synced subs, the group has no volume control."""
    await _setup_subs(setup_entry)
    entry = await _setup_group(hass, synced_members=[ADDRESS])
    assert _group_entity(hass, entry, "number", "volume") is None


# Device automations


async def test_group_device_has_no_subwoofer_triggers(
    hass: HomeAssistant, second_sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """The group device does not offer the subwoofer's triggers."""
    await _setup_subs(setup_entry)
    entry = await _setup_group(hass)
    registry = dr.async_get(hass)
    (device,) = dr.async_entries_for_config_entry(registry, entry.entry_id)
    assert (DOMAIN, f"group_{entry.entry_id}") in device.identifiers
    assert await device_trigger.async_get_triggers(hass, device.id) == []
