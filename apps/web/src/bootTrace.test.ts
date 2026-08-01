import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { bootMark } from "./bootTrace";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bootMark", () => {
  it("forwards the stage to the inline tracer", () => {
    const mark = vi.fn();
    vi.stubGlobal("window", { __t3codeBootMark: mark });

    bootMark("module-eval");
    bootMark("app-rendered");

    expect(mark.mock.calls).toEqual([["module-eval"], ["app-rendered"]]);
  });

  it("is a no-op when the page was served without the inline tracer", () => {
    vi.stubGlobal("window", {});

    expect(() => {
      bootMark("react-render");
    }).not.toThrow();
  });

  it("is a no-op outside a browser, so importing the app under test is safe", () => {
    expect(typeof window).toBe("undefined");
    expect(() => {
      bootMark("react-render");
    }).not.toThrow();
  });

  it("never lets a failing tracer break the boot it is reporting on", () => {
    vi.stubGlobal("window", {
      __t3codeBootMark: () => {
        throw new Error("storage unavailable");
      },
    });

    expect(() => {
      bootMark("route-load-start");
    }).not.toThrow();
  });
});
