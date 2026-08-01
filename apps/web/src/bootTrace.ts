/**
 * App-side hook into the boot tracer installed inline by `index.html`.
 *
 * The tracer lives in the HTML rather than here on purpose: it has to keep
 * working when this module graph never evaluates, so it cannot be part of it.
 * This wrapper only forwards marks, and is a no-op when the page was served
 * without the inline script — unit tests, and any shell built from a different
 * HTML entry.
 */

/** Ordered boot stages. Keep in sync with `STAGES` in `apps/web/index.html`. */
export type BootStage =
  | "module-eval"
  | "react-render"
  | "route-load-start"
  | "route-load-end"
  | "app-rendered";

export function bootMark(stage: BootStage): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.__t3codeBootMark?.(stage);
  } catch {
    // Diagnostics must never be able to break the boot they are reporting on.
  }
}
