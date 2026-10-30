# darblinko.github.io

Source for https://darblinko.github.io/: a project index and write-ups.

| Path | Contents |
|---|---|
| index.html | Home page: method, projects, writing, background |
| writing/<slug>/index.html | One write-up per directory, with its chart data in data.json |
| assets/site.css, assets/charts.js | Shared with the project landing pages |
| assets/pages.css | Home page and write-up additions |

Preview: `python3 -m http.server 8000` from the repository root, then open http://127.0.0.1:8000/. Charts load data.json with fetch, so opening files directly from disk does not render them.

The Results links on the home page point to https://darblinko.github.io/<repo>/. Each of those pages is a separate GitHub Pages deployment served from the `docs/` directory of its own repository (golden-goose, obd-scanner, pbi-portfolio, llm-trading-lab, agent-controls, industrial-monitor, claude-skills). They are not part of this repository, so they do not load in a local preview and return 404 until that repository is public with Pages enabled.

## Checks

| Command | Checks |
|---|---|
| `python3 -m unittest discover -s tests` | Every writing/*/data.json follows the schema below; every chart figure has data; every internal link, image, video and anchor resolves; `node --check` on assets/*.js (skipped without Node) |
| `node --test tests/*.test.mjs` | charts.js and media.js against a small stand-in DOM (tests/fake-dom.mjs): gaps in line series, empty series, one failing chart among several, a failed data.json fetch, table and focus state across a resize, clip play and pause, reduced motion |

Neither installs packages. Last run with Python 3.12.3 and Node 24.21.0.

## Chart data

Each write-up keeps its chart data in data.json next to its index.html. A page may instead embed the same object in `<script type="application/json" id="chart-data">`. A figure `<figure class="chart" data-chart="<name>"></figure>` renders the chart with that name.

```json
{
  "meta": {"article": "<slug>", "revision": "<commit or document revision>", "measured": "<date>"},
  "charts": [
    {"name": "gates", "type": "hbar", "title": "...", "subtitle": "...", "source": "<file or command>",
     "alt": "...", "format": "percent", "max": 1, "threshold": {"value": 0.8, "label": "gate 80%"},
     "data": [{"label": "recall@10", "value": 0.86, "status": "pass", "note": "..."}]}
  ]
}
```

Every chart needs `name`, `type`, `title` and `source`. `subtitle` and `alt` are optional; `alt` defaults to the title.

| type | Fields | Missing values |
|---|---|---|
| hbar | `data: [{label, value, status?, note?}]`; optional `max`, `threshold {value, label}`. `status` is `pass` or `fail`. | Not supported; every row needs a number. |
| columns | `categories: [...]`, `series: [{name, values}]` | `null` draws no bar and an empty table cell. |
| line | `x: [...]`, `series: [{name, values}]`; optional `min`, `max` | `null` breaks the line. An observation with no neighbour is drawn as a dot. The end marker and end label use the last non-null value. A series with no values draws nothing and still appears in the legend and table. |
| stats | `tiles: [{label, value, note?}]`; `value` is a preformatted string | Not applicable. |

`format` is `percent` (fractions, 0.86 prints 86%), `number` (default), `decimal2` or `decimal3`. Each `values` array has one entry per `x` or `categories` entry. At most 4 series are drawn; charts.js ignores any after the fourth, and the checks reject them. A chart that fails to draw shows its own error and leaves the other charts on the page in place; a failed data.json fetch shows the error in every figure.

## License

Text and figures are licensed under CC BY 4.0 (LICENSE). Code samples inside write-ups are Apache-2.0 unless the write-up states otherwise.
