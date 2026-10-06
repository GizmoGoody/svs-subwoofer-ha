"""Print pytest failures from a JUnit XML file as GitHub error annotations."""

import sys
import xml.etree.ElementTree as ET


def escape(text: str) -> str:
    """Escape text for a GitHub workflow command."""
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


for case in ET.parse(sys.argv[1]).iter("testcase"):
    for problem in (*case.findall("failure"), *case.findall("error")):
        detail = (problem.get("message") or "") + "\n" + (problem.text or "")
        print(f"::error title={case.get('name')}::{escape(detail.strip()[-1500:])}")
