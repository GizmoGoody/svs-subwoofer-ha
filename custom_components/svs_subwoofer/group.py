"""Subwoofer groups: control several subwoofers together.

A group is its own config entry and device. It holds no connection of its
own: it reads its members' state from their coordinators and sends commands
through them. Changing a member directly never changes the group or the other
members.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity

from .const import (
    CONF_GROUP_FEATURES,
    CONF_MEMBERS,
    CONF_OFFSETS,
    CONF_SYNCED_MEMBERS,
    CONF_VOLUME_MODE,
    DOMAIN,
    GROUP_FEATURES,
    GROUP_ID_PREFIX,
    PRESET_MANUAL,
    PRESET_MANUAL_OPTION,
    SIGNAL_MEMBERS_CHANGED,
    VOLUME_MODE_MATCHED,
    VOLUME_MODE_OFFSET,
)

if TYPE_CHECKING:
    from .coordinator import SVSSubwooferCoordinator

# Preset slot 4 is the factory default; the subwoofer does not store a name
DEFAULT_PRESET_NAME = "Default"


def preset_names(coordinator: SVSSubwooferCoordinator) -> dict[int, str]:
    """Return a subwoofer's preset names by slot, as its Preset select shows them."""
    names: dict[int, str] = {}
    for slot in range(1, 4):
        name = (coordinator.data.get(f"PRESET{slot}NAME") or "").replace("\x00", "")
        names[slot] = name.strip() or f"Preset {slot}"
    names[4] = DEFAULT_PRESET_NAME
    return names


def active_preset_name(coordinator: SVSSubwooferCoordinator) -> str | None:
    """Return the name of a subwoofer's active preset, Manual, or None if unknown."""
    active = coordinator.data.get("ACTIVE_PRESET")
    if active is None:
        return None
    if active == PRESET_MANUAL:
        return PRESET_MANUAL_OPTION
    return preset_names(coordinator).get(active)


class SVSGroup:
    """A subwoofer group's configuration and access to its members."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Read the group's settings from its config entry options."""
        self.hass = hass
        self.entry = entry
        options = entry.options
        self.members: list[str] = list(options.get(CONF_MEMBERS, []))
        self.features: set[str] = set(options.get(CONF_GROUP_FEATURES, GROUP_FEATURES))
        self.volume_mode: str = options.get(CONF_VOLUME_MODE, VOLUME_MODE_MATCHED)
        self.synced: list[str] = [
            address
            for address in options.get(CONF_SYNCED_MEMBERS, self.members)
            if address in self.members
        ]
        offsets = options.get(CONF_OFFSETS, {})
        self.offsets: dict[str, int] = {
            address: (
                int(offsets.get(address, 0))
                if self.volume_mode == VOLUME_MODE_OFFSET
                else 0
            )
            for address in self.synced
        }

    @property
    def device_info(self) -> DeviceInfo:
        """Return the group's own device."""
        return DeviceInfo(
            identifiers={(DOMAIN, f"{GROUP_ID_PREFIX}{self.entry.entry_id}")},
            name=self.entry.title,
            manufacturer="SVS",
            model="Subwoofer group",
        )

    def coordinators(
        self, addresses: list[str] | None = None
    ) -> dict[str, SVSSubwooferCoordinator]:
        """Return the members that are set up, by address, in member order."""
        loaded = {
            coordinator.address: coordinator
            for coordinator in self.hass.data.get(DOMAIN, {}).values()
        }
        return {
            address: loaded[address]
            for address in (self.members if addresses is None else addresses)
            if address in loaded
        }

    def matched_presets(self) -> dict[str, dict[str, int]]:
        """Return the preset names every member has, with each member's slot.

        Presets are matched by name, not by slot, ignoring case: LOW in one
        sub's slot 1 matches LOW in another's slot 3. Names that are missing
        from any member are left out. Names keep the first member's spelling
        and order.
        """
        coordinators = list(self.coordinators().items())
        if not coordinators:
            return {}
        matched: dict[str, dict[str, int]] = {}
        first_address, first = coordinators[0]
        for slot, name in preset_names(first).items():
            key = name.casefold()
            slots = {first_address: slot}
            for address, coordinator in coordinators[1:]:
                found = next(
                    (
                        other_slot
                        for other_slot, other in preset_names(coordinator).items()
                        if other.casefold() == key
                    ),
                    None,
                )
                if found is None:
                    break
                slots[address] = found
            else:
                matched.setdefault(name, slots)
        return matched


class SVSGroupEntity(Entity):
    """Base for a group's entities: follows every member's updates."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, group: SVSGroup, key: str) -> None:
        """Initialize the entity."""
        self.group = group
        self._attr_unique_id = f"{GROUP_ID_PREFIX}{group.entry.entry_id}_{key}"
        self._attr_device_info = group.device_info
        self._member_listeners: list[CALLBACK_TYPE] = []

    async def async_added_to_hass(self) -> None:
        """Follow the members, and re-read them when subwoofers come and go."""
        await super().async_added_to_hass()
        self.async_on_remove(
            async_dispatcher_connect(
                self.hass, SIGNAL_MEMBERS_CHANGED, self._async_members_changed
            )
        )
        self.async_on_remove(self._unsubscribe_members)
        self._subscribe_members()

    @callback
    def _subscribe_members(self) -> None:
        self._unsubscribe_members()
        for coordinator in self.group.coordinators().values():
            self._member_listeners.append(
                coordinator.async_add_listener(self._handle_member_update)
            )

    @callback
    def _unsubscribe_members(self) -> None:
        while self._member_listeners:
            self._member_listeners.pop()()

    @callback
    def _async_members_changed(self) -> None:
        self._subscribe_members()
        self.async_write_ha_state()

    @callback
    def _handle_member_update(self) -> None:
        self.async_write_ha_state()

    @property
    def available(self) -> bool:
        """Available while at least one member is set up."""
        return any(
            coordinator.last_update_success
            for coordinator in self.group.coordinators().values()
        )
