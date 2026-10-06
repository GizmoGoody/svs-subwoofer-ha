"""Detect which features the branch under test contains.

The tests live on the ci branch and run against any branch's integration
code. Each test module is marked with the features it needs and is skipped
on branches that do not have them.
"""

from __future__ import annotations

import importlib
import inspect
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

import pytest

PACKAGE = "custom_components.svs_subwoofer"


def _module(name: str = "") -> ModuleType:
    return importlib.import_module(f"{PACKAGE}.{name}" if name else PACKAGE)


def _has(module: str, attribute: str) -> bool:
    return hasattr(_module(module), attribute)


def _source_contains(module: str, text: str) -> bool:
    return text in inspect.getsource(_module(module))


FEATURES: dict[str, Callable[[], bool]] = {
    # PR 6
    "brand_images": lambda: Path(
        "custom_components/svs_subwoofer/brand/icon.png"
    ).exists(),
    # PR 7
    "bluetooth_link": lambda: _source_contains("coordinator", "CONNECTION_BLUETOOTH"),
    # PR 8
    "frame_assembly": lambda: _has("svs_protocol", "MIN_FRAME_LENGTH"),
    # PR 9
    "unknown_until_read": lambda: not _source_contains("coordinator", '"VOLUME": -20'),
    # PR 10
    "preset_detection": lambda: _has("const", "PRESET_MANUAL"),
    "quiet_preset_load": lambda: _has("coordinator", "PRESET_SETTLE_DELAY"),
    # PR 11
    "clean_shutdown": lambda: _source_contains("", "EVENT_HOMEASSISTANT_STOP"),
    # PR 12
    "backoff": lambda: _has("coordinator", "RECONNECT_BACKOFF"),
    # PR 13
    "firmware_version": lambda: bool(
        _module("svs_protocol").svs_encode("SUB_INFO2", "")[0]
    ),
    "model_name": lambda: _has("coordinator", "_SERIES_MODEL"),
    # Subwoofer groups
    "groups": lambda: _has("const", "ENTRY_TYPE_GROUP"),
    # dev only (connection options)
    "connection_modes": lambda: _has("const", "CONF_CONNECTION_MODE"),
    "quiet_field_selection": lambda: _has("const", "QUIET_KEEP_ALIVE_CHAR_UUIDS"),
}


def has(name: str) -> bool:
    """Return True if the branch under test has the feature."""
    return FEATURES[name]()


def requires(*names: str) -> pytest.MarkDecorator:
    """Skip unless the branch under test has every named feature."""
    missing = [name for name in names if not has(name)]
    return pytest.mark.skipif(
        bool(missing), reason=f"branch lacks {', '.join(missing)}"
    )


def lacks(name: str) -> pytest.MarkDecorator:
    """Skip if the branch under test has the named feature."""
    return pytest.mark.skipif(has(name), reason=f"branch has {name}")


def stay_connected_options() -> dict[str, object]:
    """Options that keep the connection open with the settings check."""
    if has("connection_modes"):
        return {"connection_mode": "constant"}
    return {"keep_alive": True}
