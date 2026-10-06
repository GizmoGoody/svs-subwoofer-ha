"""Tests for the device entry: Bluetooth link, firmware, model (PRs 7 and 13)."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from custom_components.svs_subwoofer.const import DOMAIN

from .conftest import ADDRESS, FakeSubwoofer, SetupEntry
from .features import has, requires


def _device(hass: HomeAssistant) -> dr.DeviceEntry:
    device = dr.async_get(hass).async_get_device(identifiers={(DOMAIN, ADDRESS)})
    assert device
    return device


@requires("bluetooth_link")
async def test_device_is_linked_to_its_bluetooth_address(
    hass: HomeAssistant, sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """The Bluetooth panel can match the subwoofer to its device."""
    await setup_entry()
    assert (dr.CONNECTION_BLUETOOTH, ADDRESS) in _device(hass).connections


@requires("firmware_version")
async def test_firmware_version_is_shown(
    hass: HomeAssistant, sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """The firmware version the sub reports is on the device."""
    await setup_entry()
    assert _device(hass).sw_version == "5.0.9"


@requires("firmware_version")
async def test_model_name(
    hass: HomeAssistant, sub: FakeSubwoofer, setup_entry: SetupEntry
) -> None:
    """The reported model name becomes the model, written the way SVS does."""
    await setup_entry()
    device = _device(hass)
    if has("model_name"):
        assert device.model == "SB-3000"
        assert device.hw_version is None
    else:
        assert device.hw_version == "SVS SB3000"


@requires("brand_images")
def test_brand_images_have_the_sizes_ha_expects() -> None:
    """icon and logo at 256 px, and their @2x versions at 512 px."""
    from pathlib import Path

    brand = Path("custom_components/svs_subwoofer/brand")
    for name, size in (
        ("icon.png", 256),
        ("icon@2x.png", 512),
        ("logo.png", 256),
        ("logo@2x.png", 512),
    ):
        header = (brand / name).read_bytes()[:24]
        assert header[:8] == b"\x89PNG\r\n\x1a\n", name
        width = int.from_bytes(header[16:20], "big")
        height = int.from_bytes(header[20:24], "big")
        assert (width, height) == (size, size), name
