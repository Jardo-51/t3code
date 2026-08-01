/**
 * Verifies the inline boot tracer in `apps/web/index.html`.
 *
 * That script cannot be unit tested the usual way: it is inline in the HTML on
 * purpose, so that it still runs when the module graph never evaluates. Nothing
 * in the normal pipeline parses it — `vp lint` skips `.html` and the TypeScript
 * toolchain never sees it — so this harness extracts the block and executes it
 * against a stub DOM. It records only — no rendering — so these assert what ends
 * up in the persisted trace.
 *
 * Run: node apps/web/scripts/verify-boot-diagnostics.mjs
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const indexHtml = NodePath.join(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
  "index.html",
);
const blocks = [...NodeFS.readFileSync(indexHtml, "utf8").matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .filter((block) => block.includes("Boot diagnostics"));

if (blocks.length !== 1) {
  console.error(`Expected exactly one boot diagnostics script block, found ${blocks.length}.`);
  process.exit(1);
}
const source = blocks[0];

class El {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.style = { cssText: "" };
    this._text = "";
    this.classList = { contains: () => false };
  }
  set textContent(value) {
    this._text = String(value);
  }
  get textContent() {
    return this._text || this.children.map((child) => child.textContent).join("\n");
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = [...nodes];
  }
  setAttribute() {}
  addEventListener() {}
}

function run({ marks, hasRoot = true, hasBody = true, dispatch = [], domReady = false }) {
  const root = hasRoot ? new El("div") : null;
  const body = hasBody ? new El("body") : null;
  const documentElement = new El("html");
  const store = new Map();
  const timers = [];
  const listeners = {};
  const win = {
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    setTimeout: (fn) => timers.push(fn),
    addEventListener: (type, handler) => {
      (listeners[type] ??= []).push(handler);
    },
  };
  const docListeners = {};
  const doc = {
    getElementById: (id) => (id === "root" ? root : null),
    createElement: (tag) => new El(tag),
    addEventListener: (type, handler) => {
      (docListeners[type] ??= []).push(handler);
    },
    body,
    documentElement,
  };

  new Function("window", "document", "location", "navigator", "performance", source)(
    win,
    doc,
    { href: "http://localhost/", reload() {} },
    { userAgent: "verify-boot-diagnostics", clipboard: null },
    { now: () => 7 },
  );

  if (domReady) {
    (docListeners.DOMContentLoaded ?? []).forEach((handler) => handler());
  }
  for (const stage of marks) {
    win.__t3codeBootMark(stage);
  }
  for (const { type, event } of dispatch) {
    // `window` inside the injected script is `win`, so an event whose target is
    // `win` is the module-evaluation case rather than a resource-load failure.
    const resolved = { ...event, target: event.target === "window" ? win : event.target };
    (listeners[type] ?? []).forEach((handler) => handler(resolved));
  }
  timers.forEach((fire) => fire());

  const persisted = JSON.parse(store.get("t3code:boot-trace") ?? "[]");
  return { persisted, errors: persisted.at(-1)?.errors ?? [] };
}

const FULL = ["module-eval", "react-render", "route-load-start", "route-load-end", "app-rendered"];

const cases = [
  {
    label: "a healthy boot persists every stage in order",
    config: { marks: FULL, domReady: true },
    expectPersistedStages: ["html-parsed", "dom-ready", ...FULL],
  },
  {
    label: "a graph that never evaluates persists only the pre-module marks",
    config: { marks: [], domReady: true },
    expectPersistedStages: ["html-parsed", "dom-ready"],
  },
  {
    label: "a document that never finishes parsing persists only html-parsed",
    config: { marks: [], domReady: false },
    expectPersistedStages: ["html-parsed"],
  },
  {
    // The case this exists for: the graph downloads intact, throws while
    // evaluating, and the console is unreachable because the tab is wedged.
    label: "module evaluation error is captured and persisted",
    config: {
      marks: [],
      dispatch: [
        {
          type: "error",
          event: {
            target: "window",
            message: "SyntaxError: The requested module does not provide an export named 'X'",
            filename: "http://localhost:5733/src/state/server.ts",
            lineno: 12,
            colno: 3,
            error: { stack: "at http://localhost:5733/src/state/server.ts:12:3" },
          },
        },
      ],
    },
    expectErrors: [{ kind: "error", messageIncludes: "does not provide an export" }],
  },
  {
    label: "failed resource load is captured with its url",
    config: {
      marks: [],
      dispatch: [
        {
          type: "error",
          event: { target: { tagName: "SCRIPT", src: "http://localhost:5733/src/main.tsx" } },
        },
      ],
    },
    expectErrors: [{ kind: "resource", messageIncludes: "" }],
  },
  {
    label: "unhandled rejection is captured",
    config: {
      marks: ["module-eval"],
      dispatch: [
        { type: "unhandledrejection", event: { reason: { message: "boom", stack: "at x" } } },
      ],
    },
    expectErrors: [{ kind: "unhandledrejection", messageIncludes: "boom" }],
  },
];

let failed = 0;
for (const testCase of cases) {
  const result = run(testCase.config);
  const problems = [];

  if (testCase.expectPersistedStages) {
    const stages = result.persisted.at(-1)?.marks.map((mark) => mark.stage) ?? [];
    if (stages.join(",") !== testCase.expectPersistedStages.join(",")) {
      problems.push(`persisted [${stages}], expected [${testCase.expectPersistedStages}]`);
    }
  }
  if (testCase.expectErrors) {
    for (const [i, want] of testCase.expectErrors.entries()) {
      const got = result.errors[i];
      if (!got) {
        problems.push(`expected a persisted error at index ${i}, got none`);
      } else if (got.kind !== want.kind) {
        problems.push(`error[${i}].kind = ${got.kind}, expected ${want.kind}`);
      } else if (want.messageIncludes && !String(got.message ?? "").includes(want.messageIncludes)) {
        problems.push(`error[${i}].message "${got.message}" lacks "${want.messageIncludes}"`);
      }
    }
  }

  if (problems.length > 0) {
    failed += 1;
    console.error(`FAIL  ${testCase.label}`);
    problems.forEach((problem) => console.error(`        ${problem}`));
  } else {
    console.log(`PASS  ${testCase.label}`);
  }
}

console.log(
  failed === 0 ? "\nAll boot diagnostics scenarios pass." : `\n${failed} scenario(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
