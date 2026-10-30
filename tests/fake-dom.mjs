// Minimal DOM stand-in for running assets/*.js under node:test without dependencies.
// It implements only the members those scripts use.
import { readFileSync } from "node:fs";
import vm from "node:vm";

class FakeElement {
  constructor(document, tag, namespace) {
    this.ownerDocument = document;
    this.tagName = tag.toLowerCase();
    this.namespaceURI = namespace || null;
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.dataset = {};
    this.text = "";
    this.layoutWidth = 600;
    const props = {};
    this.style = { setProperty: (key, value) => { props[key] = value; }, props };
    this.classList = {
      add: (name) => this.setAttribute("class", [...this.classNames(), name].join(" ")),
      remove: (name) => this.setAttribute("class", this.classNames().filter((c) => c !== name).join(" ")),
      contains: (name) => this.classNames().includes(name),
    };
  }

  classNames() { return (this.getAttribute("class") || "").split(/\s+/).filter(Boolean); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.has(key) ? this.attributes.get(key) : null; }
  removeAttribute(key) { this.attributes.delete(key); }
  get id() { return this.getAttribute("id"); }
  get hidden() { return this.attributes.has("hidden"); }
  set hidden(value) { if (value) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); }

  get textContent() { return this.text + this.children.map((c) => c.textContent).join(""); }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }

  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, reference) {
    if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    child.parentNode = this;
    return child;
  }
  replaceChildren(...nodes) {
    this.children.forEach((c) => { c.parentNode = null; });
    this.children = [];
    this.text = "";
    nodes.forEach((n) => this.appendChild(n));
  }
  contains(other) {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
  matches(selector) {
    return selector.split(",").some((part) => {
      const match = part.trim().match(/^([a-z0-9]*)((?:\.[\w-]+)*)((?:\[[\w-]+\])*)$/i);
      if (!match) throw new Error("fake-dom: unsupported selector " + part);
      const [, tag, classes, attrs] = match;
      if (tag && tag.toLowerCase() !== this.tagName) return false;
      if (classes && !classes.slice(1).split(".").every((c) => this.classList.contains(c))) return false;
      const names = attrs ? attrs.slice(1, -1).split("][") : [];
      return names.every((name) => name.startsWith("data-")
        ? this.dataset[name.slice(5)] !== undefined || this.attributes.has(name)
        : this.attributes.has(name));
    });
  }
  querySelectorAll(selector) { return this.descendants().filter((n) => n.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); }
  dispatch(type, extra) {
    const event = { type, target: this, clientX: 10, clientY: 10, ...extra };
    (this.listeners[type] || []).forEach((handler) => handler(event));
  }
  click() { this.dispatch("click"); }
  focus() { this.ownerDocument.activeElement = this; this.dispatch("focus"); }

  get clientWidth() { return this.layoutWidth; }
  get offsetWidth() { return 100; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.layoutWidth, height: 300 }; }
}

export function createDocument() {
  const document = {
    readyState: "complete",
    activeElement: null,
    createElement: (tag) => new FakeElement(document, tag),
    createElementNS: (namespace, tag) => new FakeElement(document, tag, namespace),
    getElementById: (id) => document.body.descendants().find((n) => n.id === id) || null,
    querySelectorAll: (selector) => document.body.querySelectorAll(selector),
    addEventListener: () => {},
  };
  document.body = new FakeElement(document, "body");
  document.activeElement = document.body;
  return document;
}

export function addChartFigure(document, name) {
  const figure = document.createElement("figure");
  figure.setAttribute("class", "chart");
  figure.setAttribute("data-chart", name);
  figure.dataset.chart = name;
  return document.body.appendChild(figure);
}

export function addInlineData(document, data) {
  const script = document.createElement("script");
  script.setAttribute("id", "chart-data");
  script.textContent = JSON.stringify(data);
  return document.body.appendChild(script);
}

// Runs a site script against the document; returns the globals so tests can drive observers.
export function runScript(path, document, globals = {}) {
  const observers = [];
  const errors = [];
  const context = {
    document,
    console: { ...console, error: (...args) => errors.push(args), warn: (...args) => errors.push(args) },
    getComputedStyle: () => ({ paddingLeft: "0px", paddingRight: "0px" }),
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
      observe(target) { this.targets.push(target); }
      fire() { this.callback(this.targets.map((target) => ({ target }))); }
    },
    fetch: () => Promise.reject(new Error("fetch not stubbed")),
    ...globals,
  };
  context.window = context;
  vm.runInNewContext(readFileSync(path, "utf8"), context, { filename: path });
  return { observers, errors, context };
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
