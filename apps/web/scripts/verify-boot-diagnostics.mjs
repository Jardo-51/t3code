/**
 * Verifies the inline boot tracer in `apps/web/index.html`.
 *
 * That script cannot be unit tested the usual way: it is inline in the HTML on
 * purpose, so that it still runs when the module graph never evaluates. Nothing
 * in the normal pipeline parses it — `vp lint` skips `.html` and the TypeScript
 * toolchain never sees it — so this harness extracts the block and executes it
 * against a stub DOM across the boot failures it is meant to report.
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

function run({ marks, hasRoot = true, hasBody = true, dispatch = [] }) {
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
  const doc = {
    getElementById: (id) => (id === "root" ? root : null),
    createElement: (tag) => new El(tag),
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

  const host = root ?? body ?? documentElement;
  const panel = host.children[0];
  const persisted = JSON.parse(store.get("t3code:boot-trace") ?? "[]");
  return {
    rendered: Boolean(panel),
    summary: panel?.children?.[0]?.children?.[1]?.textContent ?? "",
    trace: panel?.children?.[0]?.children?.[3]?.textContent ?? "",
    persisted,
    errors: persisted.at(-1)?.errors ?? [],
  };
}

const FULL = ["module-eval", "react-render", "route-load-start", "route-load-end", "app-rendered"];

const cases = [
  { label: "healthy boot renders no overlay", config: { marks: FULL }, expectOverlay: false },
  {
    label: "module graph never evaluated",
    config: { marks: [] },
    expectOverlay: true,
    expectDiagnosis: "module-eval",
  },
  {
    label: "stalled in the root route's beforeLoad",
    config: { marks: ["module-eval", "react-render", "route-load-start"] },
    expectOverlay: true,
    expectDiagnosis: "route-load-end",
  },
  {
    // Regression, observed 2026-08-01: the document stopped arriving after
    // <head>, so <body> and `#root` never existed, and the overlay silently
    // gave up at the one moment it had something worth reporting.
    label: "document stalls after <head>: no <body>, no #root",
    config: { marks: [], hasRoot: false, hasBody: false },
    expectOverlay: true,
    expectDiagnosis: "document-truncated",
  },
  {
    label: "document stalls: <body> exists but #root does not",
    config: { marks: [], hasRoot: false, hasBody: true },
    expectOverlay: true,
    expectDiagnosis: "document-truncated",
  },
  {
    label: "every stage is persisted for later readback",
    config: { marks: FULL },
    expectOverlay: false,
    expectPersistedStages: ["html-parsed", ...FULL],
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
    expectOverlay: true,
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
    expectOverlay: true,
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
    expectOverlay: true,
    expectErrors: [{ kind: "unhandledrejection", messageIncludes: "boom" }],
  },
];

let failed = 0;
for (const testCase of cases) {
  const result = run(testCase.config);
  const problems = [];

  if (result.rendered !== testCase.expectOverlay) {
    problems.push(`overlay rendered=${result.rendered}, expected ${testCase.expectOverlay}`);
  }
  if (testCase.expectDiagnosis && !result.summary.includes(testCase.expectDiagnosis)) {
    problems.push(`expected diagnosis "${testCase.expectDiagnosis}" in "${result.summary}"`);
  }
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
    if (!result.trace.includes(testCase.expectErrors[0].kind.toUpperCase())) {
      problems.push("captured error is not shown in the overlay trace");
    }
  }

  if (problems.length > 0) {
    failed += 1;
    console.error(`FAIL  ${testCase.label}`);
    problems.forEach((problem) => console.error(`        ${problem}`));
  } else {
    console.log(`PASS  ${testCase.label}${result.summary ? `\n        ${result.summary}` : ""}`);
  }
}

console.log(
  failed === 0 ? "\nAll boot diagnostics scenarios pass." : `\n${failed} scenario(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
