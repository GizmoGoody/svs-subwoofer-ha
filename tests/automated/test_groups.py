"""Tests for subwoofer groups: one device that controls several subwoofers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import (
    device_registry as dr,
    entity_registry as er,
    issue_registry as ir,
)
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.svs_subwoofer import device_trigger
from custom_components.svs_subwoofer.const import DOMAIN

from .conftest import (
    ADDRESS,
    ADDRESS2,
    NAME,
    NAME2,
    FakeBluetooth,
    FakeSubwoofer,
    SetupEntry,
    entity_id,
    settle,
)
from .features import has, requires

pytestmark = requires("groups")

STRINGS = Path("custom_components/svs_subwoofer")

ALL_FEATURES = ["preset", "standby", "volume"]
# The standby mode names, as the branch under test writes them
AUTO_ON = "Auto On" if has("standby_names") else "Auto ON"
ON = "On" if has("standby_names") else "ON"


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
    """Offset mode asks for each subwoofer's offset, by name."""
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
        {"volume_mode": "offset"},
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
    assert _state(hass, standby) == ON

    await _call(hass, "select", standby, option=AUTO_ON)
    assert sub.settings["STANDBY"] == 0
    assert second_sub.settings["STANDBY"] == 0
    assert _state(hass, standby) == AUTO_ON

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
    """Every sub follows the group volume until all were changed alone."""
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

    if has("group_volume_range"):
        # -1 is past the group's range (-58 to -2 dB): refused, nothing changes
        with pytest.raises(ServiceValidationError):
            await _call(hass, "number", volume, value=-1)
    else:
        # Sub 2 would go above 0: nothing changes
        await _call(hass, "number", volume, value=-1)
    assert sub.settings["VOLUME"] == -11
    assert second_sub.settings["VOLUME"] == -7
    assert float(_state(hass, volume)) == -9


async def test_offset_volume_follows_a_preset_load(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """A preset that sets both subs alike sets the group volume; offsets wait."""
    await _setup_subs(setup_entry)
    entry = await _setup_group(
        hass, volume_mode="offset", offsets={ADDRESS: -2, ADDRESS2: 2}
    )
    volume = _group_entity(hass, entry, "number", "volume")
    await _call(hass, "number", volume, value=-9)

    # LOW is -20 dB on both subs
    preset = _group_entity(hass, entry, "select", "preset")
    await _call(hass, "select", preset, option="LOW")
    assert float(_state(hass, volume)) == -20

    # The next group change applies the offsets again
    await _call(hass, "number", volume, value=-18)
    assert sub.settings["VOLUME"] == -20
    assert second_sub.settings["VOLUME"] == -16

    # Making them alike by hand is not a preset: the group volume stays
    await _call(hass, "number", entity_id(hass, "number", "volume"), value=-16)
    assert float(_state(hass, volume)) == -18


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


# Review fixes (PR 16)


async def _setup_entries(
    setup_entry: SetupEntry,
) -> tuple[MockConfigEntry, MockConfigEntry]:
    first = await setup_entry()
    second = await setup_entry(address=ADDRESS2, name=NAME2)
    return first, second


def _group_device(hass: HomeAssistant, entry: MockConfigEntry) -> str:
    devices = dr.async_get(hass).async_get_devices(
        identifiers={(DOMAIN, f"group_{entry.entry_id}")}
    )
    assert len(devices) == 1
    return devices[0].id


def _sub_device(hass: HomeAssistant, address: str) -> str:
    devices = dr.async_get(hass).async_get_devices(identifiers={(DOMAIN, address)})
    assert len(devices) == 1
    return devices[0].id


@requires("group_volume_range")
async def test_offset_volume_range_keeps_every_member_in_range(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """The group's range narrows by the offsets; Matched keeps the full range."""
    await _setup_subs(setup_entry)
    entry = await _setup_group(
        hass, volume_mode="offset", offsets={ADDRESS: -2, ADDRESS2: 4}
    )
    volume = _group_entity(hass, entry, "number", "volume")
    attributes = hass.states.get(volume).attributes
    assert (attributes["min"], attributes["max"]) == (-58, -4)
    # At the top of the range, sub 2 is at 0 dB
    await _call(hass, "number", volume, value=-4)
    assert sub.settings["VOLUME"] == -6
    assert second_sub.settings["VOLUME"] == 0

    matched = await _setup_group(hass, members=[ADDRESS, ADDRESS2])
    attributes = hass.states.get(_group_entity(hass, matched, "number", "volume"))
    assert (attributes.attributes["min"], attributes.attributes["max"]) == (-60, 0)


@requires("group_commands")
async def test_failed_member_command_is_sent_again(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """A member whose command fails once is sent it again."""
    await _setup_subs(setup_entry)
    entry = await _setup_group(hass)
    volume = _group_entity(hass, entry, "number", "volume")
    second_sub.fail_writes = 1
    await _call(hass, "number", volume, value=-25)
    assert sub.settings["VOLUME"] == -25
    assert second_sub.settings["VOLUME"] == -25
    assert float(_state(hass, volume)) == -25


@requires("group_commands")
async def test_member_that_does_not_follow_keeps_the_group_volume(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """The group keeps its volume and names the member it could not reach."""
    await _setup_subs(setup_entry)
    entry = await _setup_group(hass)
    volume = _group_entity(hass, entry, "number", "volume")
    await _call(hass, "number", volume, value=-20)
    second_sub.fail_writes = 10
    with pytest.raises(HomeAssistantError) as raised:
        await _call(hass, "number", volume, value=-25)
    assert NAME2 in str(raised.value)
    await settle()
    assert sub.settings["VOLUME"] == -25
    assert second_sub.settings["VOLUME"] == -20
    assert float(_state(hass, volume)) == -20


@requires("group_commands")
async def test_one_connection_slot_serves_every_member(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
    bluetooth: FakeBluetooth,
) -> None:
    """With one Bluetooth connection slot, members are reached one at a time."""
    first, second = await _setup_entries(setup_entry)
    entry = await _setup_group(hass)
    volume = _group_entity(hass, entry, "number", "volume")
    for member in (first, second):
        await member.runtime_data.async_disconnect()
    bluetooth.slots = 1
    await _call(hass, "number", volume, value=-25)
    assert sub.settings["VOLUME"] == -25
    assert second_sub.settings["VOLUME"] == -25


@requires("group_member_cleanup")
async def test_removed_subwoofer_leaves_its_groups(
    hass: HomeAssistant, second_sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """A removed subwoofer leaves the group; a group of one is a repair issue."""
    _, second = await _setup_entries(setup_entry)
    entry = await _setup_group(
        hass, volume_mode="offset", offsets={ADDRESS: -2, ADDRESS2: 2}
    )
    issue = f"group_too_few_members_{entry.entry_id}"
    assert ir.async_get(hass).async_get_issue(DOMAIN, issue) is None

    await hass.config_entries.async_remove(second.entry_id)
    await settle()
    assert entry.options["members"] == [ADDRESS]
    assert entry.options["offsets"] == {ADDRESS: -2}
    assert ir.async_get(hass).async_get_issue(DOMAIN, issue) is not None

    # Deleting the group clears the issue
    await hass.config_entries.async_remove(entry.entry_id)
    await settle()
    assert ir.async_get(hass).async_get_issue(DOMAIN, issue) is None
    for name in ("strings.json", "translations/en.json"):
        strings = json.loads((STRINGS / name).read_text(encoding="utf-8"))
        assert strings["issues"]["group_too_few_members"]["title"]


@requires("group_preset_names")
async def test_group_presets_named_manual_or_mixed_are_told_apart(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """Presets named Manual or Mixed get their slot added, and load that slot."""
    for fake in (sub, second_sub):
        fake.preset_names = ["Mixed", "Manual", "LOW"]
    await _setup_subs(setup_entry)
    entry = await _setup_group(hass)
    preset = _group_entity(hass, entry, "select", "preset")
    options = hass.states.get(preset).attributes["options"]
    assert options == [
        "Mixed (Preset 1)",
        "Manual (Preset 2)",
        "LOW",
        "Default",
        "Manual",
        "Mixed",
    ]
    await _call(hass, "select", preset, option="Manual (Preset 2)")
    assert _loaded_slots(sub)[-1] == 2
    assert _loaded_slots(second_sub)[-1] == 2
    assert _state(hass, preset) == "Manual (Preset 2)"
    await _call(hass, "select", preset, option="Mixed (Preset 1)")
    assert _state(hass, preset) == "Mixed (Preset 1)"


@requires("group_preset_names")
async def test_unnamed_slot_does_not_match_a_named_preset(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """An unnamed slot ("Preset 1") does not match a preset named Preset 1."""
    sub.preset_names = ["", "MEDIUM", "LOW"]
    second_sub.preset_names = ["MEDIUM", "Preset 1", "LOW"]
    await _setup_subs(setup_entry)
    entry = await _setup_group(hass)
    preset = _group_entity(hass, entry, "select", "preset")
    options = hass.states.get(preset).attributes["options"]
    assert options == ["MEDIUM", "LOW", "Default", "Manual", "Mixed"]


@requires("group_actions")
async def test_actions_take_a_group_as_its_subwoofers(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """load_preset and set_volume act on a group's members, at its offsets."""
    await _setup_subs(setup_entry)
    entry = await _setup_group(
        hass, volume_mode="offset", offsets={ADDRESS: -2, ADDRESS2: 2}
    )
    group = _group_device(hass, entry)

    await hass.services.async_call(
        DOMAIN, "load_preset", {"device_ids": [group], "preset": 3}, blocking=True
    )
    await settle()
    assert _loaded_slots(sub)[-1] == 3
    assert _loaded_slots(second_sub)[-1] == 3

    await hass.services.async_call(
        DOMAIN, "set_volume", {"device_ids": [group], "volume": -9}, blocking=True
    )
    await settle()
    assert sub.settings["VOLUME"] == -11
    assert second_sub.settings["VOLUME"] == -7

    # Past the group's range: brought to its end, offsets kept
    await hass.services.async_call(
        DOMAIN, "set_volume", {"device_ids": [group], "volume": 0}, blocking=True
    )
    await settle()
    assert sub.settings["VOLUME"] == -4
    assert second_sub.settings["VOLUME"] == 0

    # A member given its own offset in the call uses it
    data = {
        "device_ids": [group],
        "volume": -20,
        "offsets": {_sub_device(hass, ADDRESS2): -5},
    }
    await hass.services.async_call(DOMAIN, "set_volume", data, blocking=True)
    await settle()
    assert sub.settings["VOLUME"] == -22
    assert second_sub.settings["VOLUME"] == -25


@requires("group_actions")
async def test_sync_from_copies_to_a_group_but_not_from_one(
    hass: HomeAssistant,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """A group target stands for its other members; a group is not a source."""
    await _setup_subs(setup_entry)
    entry = await _setup_group(hass)
    group = _group_device(hass, entry)
    await hass.services.async_call(
        "number",
        "set_value",
        {"entity_id": entity_id(hass, "number", "volume"), "value": -33},
        blocking=True,
    )
    await settle()
    data = {
        "source_device_id": _sub_device(hass, ADDRESS),
        "target_device_ids": [group],
    }
    await hass.services.async_call(DOMAIN, "sync_from", data, blocking=True)
    await settle()
    assert second_sub.settings["VOLUME"] == -33

    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN,
            "sync_from",
            {"source_device_id": group, "target_device_ids": [group]},
            blocking=True,
        )
    actions = yaml.safe_load((STRINGS / "services.yaml").read_text(encoding="utf-8"))
    source = actions["sync_from"]["fields"]["source_device_id"]["selector"]["device"]
    assert source["entity"] == [{"domain": "binary_sensor"}]


@requires("group_duplicates")
async def test_group_with_the_same_subwoofers_is_refused(
    hass: HomeAssistant, second_sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """A second group of exactly the same subwoofers is refused."""
    await _setup_subs(setup_entry)
    await _setup_group(hass)
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "create_group"}
    )
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"],
        {"name": "Again", "members": [ADDRESS2, ADDRESS], "features": ["preset"]},
    )
    assert result["errors"] == {"members": "duplicate_group"}
