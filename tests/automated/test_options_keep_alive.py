"""Tests for the original options dialog (one "Stay connected" checkbox)."""

from __future__ import annotations

from homeassistant.const import CONF_ADDRESS
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.svs_subwoofer.const import DOMAIN

from .conftest import ADDRESS
from .features import lacks

pytestmark = lacks("connection_modes")


async def test_stay_connected_checkbox(hass: HomeAssistant) -> None:
    """The dialog has one checkbox and saves it."""
    entry = MockConfigEntry(
        domain=DOMAIN, unique_id=ADDRESS.lower(), data={CONF_ADDRESS: ADDRESS}
    )
    entry.add_to_hass(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "init"
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"keep_alive": True}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options == {"keep_alive": True}
