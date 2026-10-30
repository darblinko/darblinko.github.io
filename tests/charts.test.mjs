// Behavior checks for assets/charts.js and assets/media.js. Run: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDocument, addChartFigure, addInlineData, runScript, settle } from "./fake-dom.mjs";

const CHARTS = fileURLToPath(new URL("../assets/charts.js", import.meta.url));
const MEDIA = fileURLToPath(new URL("../assets/media.js", import.meta.url));
const WRITING = fileURLToPath(new URL("../writing/", import.meta.url));

function lineChart(name, values) {
  return { name, type: "line", title: name, source: "test", format: "number",
    x: values.map((_, i) => "x" + i), series: [{ name: "a", values }] };
}

async function render(charts, extraFigures = []) {
  const document = createDocument();
  const figures = charts.map((c) => addChartFigure(document, c.name));
  extraFigures.forEach((name) => figures.push(addChartFigure(document, name)));
  addInlineData(document, { charts });
  const run = runScript(CHARTS, document);
  await settle();
  return { document, figures, ...run };
}

test("a line series is split at missing values", async () => {
  const { figures } = await render([lineChart("gap", [1, 2, null, 4, 5])]);
  const lines = figures[0].querySelectorAll("polyline");
  assert.equal(lines.length, 2);
  lines.forEach((line) => assert.equal(line.getAttribute("points").split(" ").length, 2));
});

test("an isolated observation is drawn as a dot, not joined to its neighbours", async () => {
  const { figures } = await render([lineChart("dots", [1, null, 3])]);
  assert.equal(figures[0].querySelectorAll("polyline").length, 0);
  assert.ok(figures[0].querySelectorAll("circle").length >= 2);
});

test("an all-null series renders without throwing", async () => {
  const { figures, errors } = await render([lineChart("empty", [null, null])]);
  assert.deepEqual(errors, []);
  assert.ok(figures[0].querySelector("svg"));
  assert.ok(figures[0].querySelector("table"));
});

test("a failing chart does not replace the other charts on the page", async () => {
  const bad = { name: "bad", type: "pie", title: "bad", source: "test" };
  const { figures, errors } = await render([lineChart("good", [1, 2, 3]), bad], ["absent"]);
  assert.ok(figures[0].querySelector("svg"), "good chart rendered");
  assert.match(figures[1].textContent, /could not be drawn/);
  assert.match(figures[2].textContent, /missing from data\.json/);
  assert.equal(errors.length, 1);
});

test("a fetch failure is reported in every figure", async () => {
  const document = createDocument();
  const figure = addChartFigure(document, "any");
  runScript(CHARTS, document, { fetch: () => Promise.resolve({ ok: false, status: 404 }) });
  await settle();
  assert.match(figure.textContent, /Charts could not load: data\.json: HTTP 404/);
});

test("a resize keeps the data table open and the focus on its button", async () => {
  const { document, figures, observers } = await render([lineChart("resize", [1, 2, 3])]);
  const figure = figures[0];
  const button = figure.querySelector("button");
  button.click();
  button.focus();
  figure.layoutWidth = 400;
  observers[0].fire();
  const redrawn = figure.querySelector("button");
  assert.notEqual(redrawn, button, "the chart was redrawn");
  assert.equal(figure.querySelector("table").hidden, false);
  assert.equal(redrawn.getAttribute("aria-expanded"), "true");
  assert.equal(redrawn.textContent, "Hide data table");
  assert.equal(document.activeElement, redrawn);
});

test("a column with a missing value draws no bar for it", async () => {
  const chart = { name: "cols", type: "columns", title: "cols", source: "test", format: "number",
    categories: ["a", "b", "c"], series: [{ name: "s", values: [1, null, 3] }] };
  const { figures } = await render([chart]);
  assert.equal(figures[0].querySelectorAll("path").length, 2);
});

function attributesWithNaN(figure) {
  return figure.querySelectorAll("path, line, rect, circle, polyline, text, svg")
    .flatMap((element) => [...element.attributes].filter(([, value]) => value.includes("NaN")));
}

test("a horizontal chart whose values are all zero draws finite coordinates", async () => {
  const chart = { name: "zeros", type: "hbar", title: "zeros", source: "test", data: [{ label: "Errors", value: 0 }] };
  const { figures, errors } = await render([chart]);
  assert.deepEqual(errors, []);
  assert.ok(figures[0].querySelector("svg"));
  assert.deepEqual(attributesWithNaN(figures[0]), []);
});

test("a horizontal chart row without label or value reports its own error", async () => {
  const chart = { name: "blank", type: "hbar", title: "blank", source: "test", data: [{}] };
  const { figures, errors } = await render([chart]);
  assert.match(figures[0].textContent, /could not be drawn: data\[0\]\.label is not a string/);
  assert.equal(errors.length, 1);
});

test("a non-numeric series value reports its own error", async () => {
  const { figures } = await render([lineChart("text", [1, "2", 3])]);
  assert.match(figures[0].textContent, /could not be drawn: series\[0\]\.values\[1\] is not a finite number/);
});

test("malformed inline chart data shows the loading error in every figure", async () => {
  const document = createDocument();
  const figures = [addChartFigure(document, "a"), addChartFigure(document, "b")];
  const script = document.createElement("script");
  script.setAttribute("id", "chart-data");
  script.textContent = "{";
  document.body.appendChild(script);
  runScript(CHARTS, document);
  await settle();
  figures.forEach((figure) => assert.match(figure.textContent, /^Charts could not load: /));
});

function tableRows(figure) {
  return figure.querySelector("tbody").querySelectorAll("tr")
    .map((row) => row.querySelectorAll("td").map((cell) => cell.textContent));
}

for (const article of readdirSync(WRITING).sort()) {
  let data;
  try {
    data = JSON.parse(readFileSync(WRITING + article + "/data.json", "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  test(`every chart in writing/${article}/data.json renders from fetch`, async () => {
    const document = createDocument();
    const figures = data.charts.map((chart) => addChartFigure(document, chart.name));
    const requested = [];
    const fetch = (url) => {
      requested.push(url);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
    };
    const { errors } = runScript(CHARTS, document, { fetch });
    await settle();
    assert.deepEqual(requested, ["data.json"]);
    assert.deepEqual(errors, []);
    data.charts.forEach((chart, i) => {
      const figure = figures[i];
      assert.equal(figure.querySelector(".chart-title").textContent, chart.title, chart.name);
      assert.deepEqual(attributesWithNaN(figure), [], chart.name);
      const rows = tableRows(figure);
      if (chart.type === "hbar") {
        assert.deepEqual(rows.map((row) => row[0]), chart.data.map((row) => row.label), chart.name);
        rows.forEach((row) => assert.notEqual(row[1], "", chart.name));
      } else if (chart.type === "stats") {
        const shown = figure.querySelectorAll(".stat-value").map((tile) => tile.textContent);
        assert.deepEqual(shown, chart.tiles.map((tile) => tile.value), chart.name);
      } else {
        assert.equal(rows.length, (chart.categories || chart.x).length, chart.name);
      }
    });
  });
}

test("clips play when on screen and pause when off screen", () => {
  const document = createDocument();
  const clip = document.createElement("video");
  clip.setAttribute("data-autoplay", "");
  document.body.appendChild(clip);
  const calls = [];
  clip.play = () => { calls.push("play"); return Promise.resolve(); };
  clip.pause = () => calls.push("pause");
  let callback;
  runScript(MEDIA, document, {
    IntersectionObserver: class { constructor(cb) { callback = cb; } observe() {} },
    matchMedia: () => ({ matches: false }),
  });
  callback([{ target: clip, isIntersecting: true }]);
  callback([{ target: clip, isIntersecting: false }]);
  assert.deepEqual(calls, ["play", "pause"]);
});

test("clips do not autoplay for readers who prefer reduced motion", () => {
  const document = createDocument();
  const clip = document.createElement("video");
  clip.setAttribute("data-autoplay", "");
  document.body.appendChild(clip);
  let observed = false;
  runScript(MEDIA, document, {
    IntersectionObserver: class { constructor() { observed = true; } observe() {} },
    matchMedia: () => ({ matches: true }),
  });
  assert.equal(observed, false);
});
