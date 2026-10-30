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

Text and figures are licensed under CC BY 4.0 (LICENSE). Code samples inside write-ups are Apache-2.0 unless the write-up states otherwise.
