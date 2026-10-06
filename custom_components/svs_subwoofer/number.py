"""Number platform for SVS Subwoofer."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from homeassistant.components.number import (
    NumberEntity,
    NumberEntityDescription,
    NumberMode,
    RestoreNumber,
)
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import SVSConfigEntry
from .const import (
    GROUP_FEATURE_VOLUME,
    LPF_FREQ_MAX,
    LPF_FREQ_MIN,
    LPF_FREQ_STEP,
    PEQ_BOOST_MAX,
    PEQ_BOOST_MIN,
    PEQ_BOOST_STEP,
    PEQ_FREQ_MAX,
    PEQ_FREQ_MIN,
    PEQ_FREQ_STEP,
    PEQ_Q_MAX,
    PEQ_Q_MIN,
    PEQ_Q_STEP,
    PHASE_MAX,
    PHASE_MIN,
    PHASE_STEP,
    VOLUME_MAX,
    VOLUME_MIN,
    VOLUME_STEP,
)
from .coordinator import SVSSubwooferCoordinator
from .group import SVSGroup, SVSGroupEntity

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, kw_only=True)
class SVSNumberEntityDescription(NumberEntityDescription):
    """Describes SVS number entity."""

    svs_param: str


NUMBER_DESCRIPTIONS: tuple[SVSNumberEntityDescription, ...] = (
    SVSNumberEntityDescription(
        key="volume",
        translation_key="volume",
        svs_param="VOLUME",
        native_min_value=VOLUME_MIN,
        native_max_value=VOLUME_MAX,
        native_step=VOLUME_STEP,
        native_unit_of_measurement="dB",
        mode=NumberMode.SLIDER,
        icon="mdi:volume-high",
    ),
    SVSNumberEntityDescription(
        key="phase",
        translation_key="phase",
        svs_param="PHASE",
        native_min_value=PHASE_MIN,
        native_max_value=PHASE_MAX,
        native_step=PHASE_STEP,
        native_unit_of_measurement="°",
        mode=NumberMode.SLIDER,
        icon="mdi:sine-wave",
    ),
    SVSNumberEntityDescription(
        key="lpf_frequency",
        translation_key="lpf_frequency",
        svs_param="LOW_PASS_FILTER_FREQ",
        entity_category=EntityCategory.CONFIG,
        native_min_value=LPF_FREQ_MIN,
        native_max_value=LPF_FREQ_MAX,
        native_step=LPF_FREQ_STEP,
        native_unit_of_measurement="Hz",
        mode=NumberMode.SLIDER,
        icon="mdi:tune-vertical",
    ),
    # PEQ1
    SVSNumberEntityDescription(
        key="peq1_frequency",
        translation_key="peq1_frequency",
        svs_param="PEQ1_FREQ",
        entity_category=EntityCategory.CONFIG,
        native_min_value=PEQ_FREQ_MIN,
        native_max_value=PEQ_FREQ_MAX,
        native_step=PEQ_FREQ_STEP,
        native_unit_of_measurement="Hz",
        mode=NumberMode.SLIDER,
        icon="mdi:equalizer",
    ),
    SVSNumberEntityDescription(
        key="peq1_boost",
        translation_key="peq1_boost",
        svs_param="PEQ1_BOOST",
        entity_category=EntityCategory.CONFIG,
        native_min_value=PEQ_BOOST_MIN,
        native_max_value=PEQ_BOOST_MAX,
        native_step=PEQ_BOOST_STEP,
        native_unit_of_measurement="dB",
        mode=NumberMode.SLIDER,
        icon="mdi:equalizer",
    ),
    SVSNumberEntityDescription(
        key="peq1_q_factor",
        translation_key="peq1_q_factor",
        svs_param="PEQ1_QFACTOR",
        entity_category=EntityCategory.CONFIG,
        native_min_value=PEQ_Q_MIN,
        native_max_value=PEQ_Q_MAX,
        native_step=PEQ_Q_STEP,
        mode=NumberMode.BOX,
        icon="mdi:equalizer",
    ),
    # PEQ2
    SVSNumberEntityDescription(
        key="peq2_frequency",
        translation_key="peq2_frequency",
        svs_param="PEQ2_FREQ",
        entity_category=EntityCategory.CONFIG,
        native_min_value=PEQ_FREQ_MIN,
        native_max_value=PEQ_FREQ_MAX,
        native_step=PEQ_FREQ_STEP,
        native_unit_of_measurement="Hz",
        mode=NumberMode.SLIDER,
        icon="mdi:equalizer",
    ),
    SVSNumberEntityDescription(
        key="peq2_boost",
        translation_key="peq2_boost",
        svs_param="PEQ2_BOOST",
        entity_category=EntityCategory.CONFIG,
        native_min_value=PEQ_BOOST_MIN,
        native_max_value=PEQ_BOOST_MAX,
        native_step=PEQ_BOOST_STEP,
        native_unit_of_measurement="dB",
        mode=NumberMode.SLIDER,
        icon="mdi:equalizer",
    ),
    SVSNumberEntityDescription(
        key="peq2_q_factor",
        translation_key="peq2_q_factor",
        svs_param="PEQ2_QFACTOR",
        entity_category=EntityCategory.CONFIG,
        native_min_value=PEQ_Q_MIN,
        native_max_value=PEQ_Q_MAX,
        native_step=PEQ_Q_STEP,
        mode=NumberMode.BOX,
        icon="mdi:equalizer",
    ),
    # PEQ3
    SVSNumberEntityDescription(
        key="peq3_frequency",
        translation_key="peq3_frequency",
        svs_param="PEQ3_FREQ",
        entity_category=EntityCategory.CONFIG,
        native_min_value=PEQ_FREQ_MIN,
        native_max_value=PEQ_FREQ_MAX,
        native_step=PEQ_FREQ_STEP,
        native_unit_of_measurement="Hz",
        mode=NumberMode.SLIDER,
        icon="mdi:equalizer",
    ),
    SVSNumberEntityDescription(
        key="peq3_boost",
        translation_key="peq3_boost",
        svs_param="PEQ3_BOOST",
        entity_category=EntityCategory.CONFIG,
        native_min_value=PEQ_BOOST_MIN,
        native_max_value=PEQ_BOOST_MAX,
        native_step=PEQ_BOOST_STEP,
        native_unit_of_measurement="dB",
        mode=NumberMode.SLIDER,
        icon="mdi:equalizer",
    ),
    SVSNumberEntityDescription(
        key="peq3_q_factor",
        translation_key="peq3_q_factor",
        svs_param="PEQ3_QFACTOR",
        entity_category=EntityCategory.CONFIG,
        native_min_value=PEQ_Q_MIN,
        native_max_value=PEQ_Q_MAX,
        native_step=PEQ_Q_STEP,
        mode=NumberMode.BOX,
        icon="mdi:equalizer",
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: SVSConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up SVS number entities."""
    if isinstance(entry.runtime_data, SVSGroup):
        group = entry.runtime_data
        # The group volume only makes sense with at least two synced subs
        if GROUP_FEATURE_VOLUME in group.features and len(group.synced) >= 2:
            async_add_entities([SVSGroupVolumeNumber(group)])
        return

    coordinator = entry.runtime_data

    async_add_entities(
        SVSNumberEntity(coordinator, description) for description in NUMBER_DESCRIPTIONS
    )


class SVSNumberEntity(CoordinatorEntity[SVSSubwooferCoordinator], NumberEntity):
    """Representation of an SVS number entity."""

    _attr_has_entity_name = True
    entity_description: SVSNumberEntityDescription

    def __init__(
        self,
        coordinator: SVSSubwooferCoordinator,
        description: SVSNumberEntityDescription,
    ) -> None:
        """Initialize the number entity."""
        super().__init__(coordinator)
        self.entity_description = description
        self._attr_unique_id = f"{coordinator.address}_{description.key}"
        self._attr_device_info = coordinator.device_info

    @property
    def native_value(self) -> float | None:
        """Return current value."""
        value = self.coordinator.data.get(self.entity_description.svs_param)
        if value is None:
            return None
        return float(value)

    async def async_set_native_value(self, value: float) -> None:
        """Update the value."""
        _LOGGER.debug("Setting %s to %s", self.entity_description.key, value)

        # Convert to int for integer parameters
        if self.entity_description.native_step == 1:
            value = int(value)

        success = await self.coordinator.async_send_command(
            self.entity_description.svs_param, value
        )
        if not success:
            raise HomeAssistantError(
                f"Failed to set {self.entity_description.key} to {value}"
            )


class SVSGroupVolumeNumber(SVSGroupEntity, RestoreNumber):
    """A group's volume, applied to every synced member.

    The group volume G is remembered. In Matched mode every synced member is
    set to G. In Offset mode each synced member is set to G plus its own
    offset, and the slider shows the loudest synced member's level (G plus the
    largest offset). Every change sends each member its absolute target, which
    restores the offsets after a member was changed on its own.
    """

    _attr_translation_key = "group_volume"
    _attr_icon = "mdi:volume-high"
    _attr_native_min_value = VOLUME_MIN
    _attr_native_max_value = VOLUME_MAX
    _attr_native_step = VOLUME_STEP
    _attr_native_unit_of_measurement = "dB"
    _attr_mode = NumberMode.SLIDER

    def __init__(self, group: SVSGroup) -> None:
        """Initialize the entity."""
        super().__init__(group, "volume")
        self._group_volume: float | None = None
        self._loudest_offset = max(group.offsets.values(), default=0)

    async def async_added_to_hass(self) -> None:
        """Restore the group volume from before a restart."""
        await super().async_added_to_hass()
        last = await self.async_get_last_number_data()
        if last and last.native_value is not None:
            self._group_volume = last.native_value - self._loudest_offset

    def _member_group_volumes(self) -> list[float]:
        """Return the group volume each synced member's volume implies."""
        coordinators = self.group.coordinators(self.group.synced)
        return [
            float(coordinator.data["VOLUME"]) - self.group.offsets[address]
            for address, coordinator in coordinators.items()
            if coordinator.data.get("VOLUME") is not None
        ]

    @property
    def native_value(self) -> float | None:
        """Return the group volume as the loudest synced member hears it.

        Shown while at least one synced member is still at its target, so
        changing one member on its own does not change the group. Unknown when
        none is; with no remembered group volume, the members must agree.
        """
        implied = self._member_group_volumes()
        if self._group_volume is not None:
            if self._group_volume in implied:
                return self._group_volume + self._loudest_offset
            return None
        if implied and len(set(implied)) == 1:
            return implied[0] + self._loudest_offset
        return None

    async def async_set_native_value(self, value: float) -> None:
        """Set every synced member to its target for this group volume."""
        group_volume = int(value) - self._loudest_offset
        targets = {
            address: group_volume + offset
            for address, offset in self.group.offsets.items()
        }
        if not all(VOLUME_MIN <= target <= VOLUME_MAX for target in targets.values()):
            # A member would go past its limit: leave everything as it is
            self.async_write_ha_state()
            return
        coordinators = self.group.coordinators(self.group.synced)
        results = await asyncio.gather(
            *(
                coordinators[address].async_send_command("VOLUME", target)
                for address, target in targets.items()
                if address in coordinators
            )
        )
        self._group_volume = group_volume
        self.async_write_ha_state()
        if not all(results):
            raise HomeAssistantError("Could not set the volume on every subwoofer")
