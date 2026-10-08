"""Card UI tests: the dashboard card and its editors in a real browser.

Home Assistant runs here with its real frontend and the fake subwoofers; a
headless Chrome (driven by ui/driver.mjs) opens it, and ui/page_tests.js
exercises the SVS Subwoofer card, the panel prototype and their editors
with Home Assistant's own components. Screenshots of every finish, in the
light and the dark scheme, are saved for review.

These run in their own CI job (SVS_UI_TESTS=1), which has Chrome and Node.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
from datetime import timedelta
from pathlib import Path

import pytest
from homeassistant.auth.models import TOKEN_TYPE_LONG_LIVED_ACCESS_TOKEN
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.svs_subwoofer.const import DOMAIN

from .conftest import ADDRESS, ADDRESS2, NAME2, FakeSubwoofer, SetupEntry, settle
from .features import has, requires

UI = Path(__file__).parent / "ui"

pytestmark = [
    requires("card"),
    pytest.mark.skipif(
        not os.environ.get("SVS_UI_TESTS"), reason="UI tests run in their own job"
    ),
    pytest.mark.skipif(shutil.which("node") is None, reason="Node.js not installed"),
]


async def test_card_ui(
    hass: HomeAssistant,
    hass_storage: dict,
    hass_admin_user,
    hass_client,
    sub: FakeSubwoofer,
    second_sub: FakeSubwoofer,
    setup_entry: SetupEntry,
) -> None:
    """The card and its editors work in Home Assistant's real frontend."""
    # Past onboarding, so the frontend opens the dashboard
    hass_storage["onboarding"] = {
        "version": 4,
        "minor_version": 1,
        "key": "onboarding",
        "data": {"done": ["user", "core_config", "analytics", "integration"]},
    }
    # A stored dashboard: only a dashboard page provides the card helpers
    # that editors load the tile card's editor with
    hass_storage["lovelace"] = {
        "version": 1,
        "minor_version": 1,
        "key": "lovelace",
        "data": {"config": {"views": [{"title": "Test", "path": "test", "cards": []}]}},
    }
    # The frontend first, so the integration can add its card to it
    assert await async_setup_component(hass, "frontend", {})
    await setup_entry()
    await setup_entry(address=ADDRESS2, name=NAME2)
    if has("groups"):
        group = MockConfigEntry(
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
        group.add_to_hass(hass)
        assert await hass.config_entries.async_setup(group.entry_id)
    await settle()

    client = await hass_client()
    url = str(client.make_url("/"))
    refresh = await hass.auth.async_create_refresh_token(
        hass_admin_user,
        client_name="SVS card UI tests",
        token_type=TOKEN_TYPE_LONG_LIVED_ACCESS_TOKEN,
        access_token_expiration=timedelta(days=1),
    )
    token = hass.auth.async_create_access_token(refresh)

    out = Path(os.environ.get("SVS_UI_OUT", "ui-results"))
    out.mkdir(parents=True, exist_ok=True)
    proc = await asyncio.create_subprocess_exec(
        "node",
        str(UI / "driver.mjs"),
        url,
        token,
        str(out),
        str(UI / "page_tests.js"),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), 300)
    print(stdout.decode(), stderr.decode())

    report = json.loads((out / "report.json").read_text())
    failed = [r for r in report if not r["ok"]]
    assert not failed, "\n\n".join(f"{r['name']}:\n{r['detail']}" for r in failed)
