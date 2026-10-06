"""Tests for the Bluetooth Connection Options dialog and the connection modes."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from homeassistant.const import CONF_ADDRESS
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.svs_subwoofer import coordinator as coordinator_module
from custom_components.svs_subwoofer.const import DOMAIN

from .conftest import ADDRESS, FakeSubwoofer, SetupEntry, settle
from .features import requires

pytestmark = requires("connection_modes")

STRINGS = Path("custom_components/svs_subwoofer")


def _entry(hass: HomeAssistant, options: dict | None = None) -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id=ADDRESS.lower(),
        data={CONF_ADDRESS: ADDRESS},
        options=options or {},
    )
    entry.add_to_hass(hass)
    return entry


async def test_periodic_opens_the_timing_step(hass: HomeAssistant) -> None:
    """Periodic is the default and leads to the timing step."""
    entry = _entry(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["step_id"] == "init"
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"connection_mode": "periodic"}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "timing"
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"reconnect_interval": 300, "disconnect_after": 120}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options == {
        "connection_mode": "periodic",
        "reconnect_interval": 300,
        "disconnect_after": 120,
    }


async def test_timing_fields_fall_back_to_defaults(hass: HomeAssistant) -> None:
    """The timing fields are optional; empty ones use their defaults."""
    entry = _entry(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"connection_mode": "periodic"}
    )
    result = await hass.config_entries.options.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert entry.options["reconnect_interval"] == 0
    assert entry.options["disconnect_after"] == 60


async def test_constant_and_quiet_keep_the_timing_values(hass: HomeAssistant) -> None:
    """Constant and Quiet save at once and keep the stored timing values."""
    for mode in ("constant", "quiet"):
        entry = _entry(
            hass,
            {
                "connection_mode": "periodic",
                "reconnect_interval": 300,
                "disconnect_after": 90,
            },
        )
        result = await hass.config_entries.options.async_init(entry.entry_id)
        result = await hass.config_entries.options.async_configure(
            result["flow_id"], {"connection_mode": mode}
        )
        assert result["type"] is FlowResultType.CREATE_ENTRY
        assert entry.options == {
            "connection_mode": mode,
            "reconnect_interval": 300,
            "disconnect_after": 90,
        }
        await hass.config_entries.async_remove(entry.entry_id)


async def test_old_keep_alive_is_not_carried_over(hass: HomeAssistant) -> None:
    """An entry with only the old keep_alive flag starts at Periodic."""
    entry = _entry(hass, {"keep_alive": True})
    result = await hass.config_entries.options.async_init(entry.entry_id)
    schema = result["data_schema"].schema
    default = next(key for key in schema if key == "connection_mode").default()
    assert default == "periodic"


def test_dialog_text() -> None:
    """Both steps share the title, and each mode carries its description."""
    for name in ("strings.json", "translations/en.json"):
        strings = json.loads((STRINGS / name).read_text(encoding="utf-8"))
        steps = strings["options"]["step"]
        assert steps["init"]["title"] == "Bluetooth Connection Options"
        assert steps["timing"]["title"] == "Bluetooth Connection Options"
        labels = strings["selector"]["connection_mode"]["options"]
        for mode, label in (
            ("periodic", "Periodic"),
            ("constant", "Constant"),
            ("quiet", "Quiet"),
        ):
            assert labels[mode].startswith(f"{label} – ")
        assert "n't" not in json.dumps(strings), "contraction in UI text"


async def test_periodic_disconnects_and_refreshes(
    hass: HomeAssistant, sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """Periodic disconnects after the hang-on time and reconnects to refresh."""
    await setup_entry(
        {
            "connection_mode": "periodic",
            "reconnect_interval": 0.2,
            "disconnect_after": 0.1,
        }
    )
    await settle(1.0)
    # Connected at setup, then disconnected and reconnected at least once
    assert sub.connects >= 2


async def test_constant_checks_with_a_settings_request(
    hass: HomeAssistant, sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """Constant keeps the connection and checks it by asking for settings."""
    with (
        patch.object(coordinator_module, "KEEP_ALIVE_INTERVAL", 0.1),
        patch.object(coordinator_module, "LIVENESS_STALE_AFTER", 0),
    ):
        await setup_entry({"connection_mode": "constant"})
        reads_at_setup = sub.frame_types().count("f11f")
        await settle(0.6)
    assert sub.frame_types().count("f11f") > reads_at_setup
    assert sub.connects == 1
    assert sub.info_reads == []


async def test_quiet_checks_without_settings_requests(
    hass: HomeAssistant, sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """Quiet keeps the connection with a standard read, not a settings request."""
    with patch.object(coordinator_module, "KEEP_ALIVE_INTERVAL", 0.1):
        await setup_entry({"connection_mode": "quiet"})
        reads_at_setup = sub.frame_types().count("f11f")
        await settle(0.6)
    assert sub.frame_types().count("f11f") == reads_at_setup
    assert len(sub.info_reads) >= 3
    assert sub.connects == 1
