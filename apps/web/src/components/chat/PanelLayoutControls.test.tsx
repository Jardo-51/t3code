import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PanelLayoutControls, panelAttentionLabel } from "./PanelLayoutControls";

describe("PanelLayoutControls", () => {
  it("keeps unavailable panel tooltip triggers interactive", () => {
    const markup = renderToStaticMarkup(
      <PanelLayoutControls
        showTerminalControl
        terminalAvailable={false}
        terminalOpen={false}
        terminalShortcutLabel={null}
        rightPanelAvailable={false}
        rightPanelOpen={false}
        rightPanelShortcutLabel={null}
        liveAgentCount={0}
        onToggleTerminal={() => {}}
        onToggleRightPanel={() => {}}
      />,
    );

    expect(markup.match(/data-slot="tooltip-trigger"/g)).toHaveLength(2);
    expect(markup.match(/data-slot="tooltip-trigger"[^>]*><button[^>]*disabled=""/g)).toHaveLength(
      2,
    );
  });
});

describe("panelAttentionLabel", () => {
  it("says nothing when the panel holds nothing to look at", () => {
    expect(panelAttentionLabel(0, 0)).toBeNull();
  });

  it("names each contributor so one number is never ambiguous", () => {
    expect(panelAttentionLabel(2, 0)).toBe("2 agents working");
    expect(panelAttentionLabel(0, 1)).toBe("1 memory saved");
    expect(panelAttentionLabel(1, 3)).toBe("1 agent working, 3 memories saved");
  });
});
