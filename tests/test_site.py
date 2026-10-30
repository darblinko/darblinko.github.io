"""Static checks for the site: chart data, internal links and anchors, script syntax.

Run from the repository root: python3 -m unittest discover -s tests
"""

import json
import shutil
import subprocess
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
PAGES = sorted(p for p in ROOT.rglob("index.html") if "tests" not in p.parts)
CHART_FIELDS = {
    "hbar": ["data"],
    "columns": ["categories", "series"],
    "line": ["x", "series"],
    "stats": ["tiles"],
}
MAX_SERIES = 4
EXTERNAL_SCHEMES = {"http", "https", "mailto", "data", "tel"}


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.references = []
        self.chart_names = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if "id" in attributes:
            self.ids.add(attributes["id"])
        for key in ("href", "src", "srcset", "poster"):
            if attributes.get(key):
                self.references.append((tag, key, attributes[key]))
        if tag == "figure" and "data-chart" in attributes:
            self.chart_names.append(attributes["data-chart"])


def parse(page):
    parser = PageParser()
    parser.feed(page.read_text(encoding="utf-8"))
    return parser


def resolve(page, reference):
    """Return (target file, fragment) for an internal reference, or None for an external one."""
    parts = urlsplit(reference)
    if parts.scheme in EXTERNAL_SCHEMES or parts.netloc:
        return None
    if not parts.path:
        return page, parts.fragment
    base = ROOT if parts.path.startswith("/") else page.parent
    target = (base / unquote(parts.path).lstrip("/")).resolve()
    if parts.path.endswith("/") or target.is_dir():
        target = target / "index.html"
    return target, parts.fragment


class ChartDataTest(unittest.TestCase):
    def test_every_data_file_follows_the_schema(self):
        for data_file in sorted(ROOT.glob("writing/*/data.json")):
            with self.subTest(data_file=data_file.relative_to(ROOT)):
                charts = json.loads(data_file.read_text(encoding="utf-8"))["charts"]
                names = [chart["name"] for chart in charts]
                self.assertEqual(len(names), len(set(names)), "duplicate chart names")
                for chart in charts:
                    self.assertIn(chart["type"], CHART_FIELDS, chart["name"])
                    for field in ["title", "source"] + CHART_FIELDS[chart["type"]]:
                        self.assertIn(field, chart, chart["name"])
                    self.assertLessEqual(len(chart.get("series", [])), MAX_SERIES, chart["name"])
                    keys = chart.get("x") or chart.get("categories") or []
                    for series in chart.get("series", []):
                        self.assertEqual(len(series["values"]), len(keys), chart["name"])

    def test_every_chart_figure_has_data(self):
        for page in PAGES:
            names = parse(page).chart_names
            if not names:
                continue
            with self.subTest(page=page.relative_to(ROOT)):
                data = json.loads((page.parent / "data.json").read_text(encoding="utf-8"))
                defined = {chart["name"] for chart in data["charts"]}
                self.assertEqual(sorted(set(names) - defined), [])


class LinkTest(unittest.TestCase):
    def test_internal_links_and_anchors_resolve(self):
        parsed = {page.resolve(): parse(page) for page in PAGES}
        for page in PAGES:
            for tag, key, value in parsed[page.resolve()].references:
                candidates = [item.split()[0] for item in value.split(",")] if key == "srcset" else [value]
                for reference in candidates:
                    resolved = resolve(page.resolve(), reference)
                    if resolved is None:
                        continue
                    target, fragment = resolved
                    with self.subTest(page=page.relative_to(ROOT), reference=reference):
                        self.assertTrue(target.is_file(), f"{target} does not exist")
                        if fragment:
                            ids = parsed[target].ids if target in parsed else parse(target).ids
                            self.assertIn(fragment, ids)


class ScriptSyntaxTest(unittest.TestCase):
    def test_scripts_parse(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("node is not installed")
        for script in sorted(ROOT.glob("assets/*.js")):
            with self.subTest(script=script.name):
                result = subprocess.run([node, "--check", str(script)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
