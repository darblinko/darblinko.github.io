"""Static checks for the site: chart data, internal links and anchors, script syntax.

Run from the repository root: python3 -m unittest discover -s tests
"""

import json
import math
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
FORMATS = {"percent", "number", "decimal2", "decimal3"}
STATUSES = {"pass", "fail"}
EXTERNAL_SCHEMES = {"http", "https", "mailto", "data", "tel"}


def is_number(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def chart_errors(chart):
    """Return the schema violations of one chart, in the terms charts.js documents."""
    name = chart.get("name", "<unnamed>")
    kind = chart.get("type")
    if kind not in CHART_FIELDS:
        return [f"{name}: unknown type {kind!r}"]
    errors = [
        f"{name}: missing {field}"
        for field in ["title", "source"] + CHART_FIELDS[kind]
        if field not in chart
    ]
    if errors:
        return errors
    if chart.get("format", "number") not in FORMATS:
        errors.append(f"{name}: unknown format {chart['format']!r}")
    for bound in ("max", "min"):
        if bound in chart and not is_number(chart[bound]):
            errors.append(f"{name}: {bound} is not a finite number")
    if is_number(chart.get("max")) and chart["max"] <= 0 and kind != "line":
        errors.append(f"{name}: max must be positive")
    if "threshold" in chart and not is_number(chart["threshold"].get("value")):
        errors.append(f"{name}: threshold value is not a finite number")
    if kind == "hbar":
        if not chart["data"]:
            errors.append(f"{name}: data is empty")
        for i, row in enumerate(chart["data"]):
            if not isinstance(row.get("label"), str):
                errors.append(f"{name}: data[{i}].label is not a string")
            if not is_number(row.get("value")):
                errors.append(f"{name}: data[{i}].value is not a finite number")
            if "status" in row and row["status"] not in STATUSES:
                errors.append(f"{name}: data[{i}].status is not pass or fail")
    elif kind == "stats":
        for i, tile in enumerate(chart["tiles"]):
            if not isinstance(tile.get("label"), str) or not isinstance(
                tile.get("value"), str
            ):
                errors.append(f"{name}: tiles[{i}] needs string label and value")
    else:
        keys = chart["x"] if kind == "line" else chart["categories"]
        if len(chart["series"]) > MAX_SERIES:
            errors.append(f"{name}: more than {MAX_SERIES} series")
        for si, series in enumerate(chart["series"]):
            values = series.get("values")
            if not isinstance(series.get("name"), str) or not isinstance(values, list):
                errors.append(
                    f"{name}: series[{si}] needs a string name and a values list"
                )
                continue
            if len(values) != len(keys):
                errors.append(
                    f"{name}: series[{si}] has {len(values)} values for {len(keys)} keys"
                )
            for i, value in enumerate(values):
                if value is not None and not is_number(value):
                    errors.append(
                        f"{name}: series[{si}].values[{i}] is not a finite number or null"
                    )
    return errors


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
                self.assertEqual(
                    [error for chart in charts for error in chart_errors(chart)], []
                )

    def test_schema_check_rejects_malformed_charts(self):
        base = {"name": "c", "title": "t", "source": "s"}
        malformed = [
            {**base, "type": "hbar", "data": [{}]},
            {**base, "type": "hbar", "data": [{"label": "a", "value": "1"}]},
            {**base, "type": "hbar", "data": [{"label": "a", "value": float("nan")}]},
            {
                **base,
                "type": "hbar",
                "data": [{"label": "a", "value": 1, "status": "ok"}],
            },
            {**base, "type": "hbar", "max": 0, "data": [{"label": "a", "value": 0}]},
            {
                **base,
                "type": "line",
                "x": [1, 2],
                "series": [{"name": "a", "values": [1, True]}],
            },
            {
                **base,
                "type": "columns",
                "categories": ["a"],
                "series": [{"name": "a", "values": [1, 2]}],
            },
            {**base, "type": "stats", "tiles": [{"label": "a", "value": 1}]},
            {**base, "type": "pie"},
        ]
        for chart in malformed:
            with self.subTest(chart=chart):
                self.assertNotEqual(chart_errors(chart), [])
        valid = {
            **base,
            "type": "line",
            "x": [1, 2],
            "series": [{"name": "a", "values": [None, 2.5]}],
        }
        self.assertEqual(chart_errors(valid), [])

    def test_every_chart_figure_has_data(self):
        for page in PAGES:
            names = parse(page).chart_names
            if not names:
                continue
            with self.subTest(page=page.relative_to(ROOT)):
                data = json.loads(
                    (page.parent / "data.json").read_text(encoding="utf-8")
                )
                defined = {chart["name"] for chart in data["charts"]}
                self.assertEqual(sorted(set(names) - defined), [])


class LinkTest(unittest.TestCase):
    def test_internal_links_and_anchors_resolve(self):
        parsed = {page.resolve(): parse(page) for page in PAGES}
        for page in PAGES:
            for tag, key, value in parsed[page.resolve()].references:
                candidates = (
                    [item.split()[0] for item in value.split(",")]
                    if key == "srcset"
                    else [value]
                )
                for reference in candidates:
                    resolved = resolve(page.resolve(), reference)
                    if resolved is None:
                        continue
                    target, fragment = resolved
                    with self.subTest(page=page.relative_to(ROOT), reference=reference):
                        self.assertTrue(target.is_file(), f"{target} does not exist")
                        if fragment:
                            ids = (
                                parsed[target].ids
                                if target in parsed
                                else parse(target).ids
                            )
                            self.assertIn(fragment, ids)


class ScriptSyntaxTest(unittest.TestCase):
    def test_scripts_parse(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("node is not installed")
        for script in sorted(ROOT.glob("assets/*.js")):
            with self.subTest(script=script.name):
                result = subprocess.run(
                    [node, "--check", str(script)],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
