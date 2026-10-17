import { describe, expect, it } from "vitest";

import { getNextScrollOffset, selectPanelViewport } from "../../src/app/tui/app.js";

describe("tui activity panel layout", () => {
  it("keeps transcript panels bottom-aligned", () => {
    const lines = ["one", "two", "three", "four", "five"];

    expect(selectPanelViewport(lines, 5, "bottom")).toMatchObject({
      lines: ["three", "four", "five"],
      startLine: 3,
      endLine: 5,
      totalLines: 5,
      maxOffset: 2,
      scrollOffset: 0
    });
  });

  it("keeps the latest activity visible below older calls", () => {
    const lines = [
      "A - Senior: fixture",
      "  session A-session-1",
      "  health ok",
      "  recent",
      "  - completed read",
      "  - completed search",
      "Why: checking the approved files",
      "Now: reading src/package.json"
    ];

    expect(selectPanelViewport(lines, 6, "bottom")).toMatchObject({
      lines: [
        "  - completed read",
        "  - completed search",
        "Why: checking the approved files",
        "Now: reading src/package.json"
      ],
      startLine: 5,
      endLine: 8,
      totalLines: 8,
      maxOffset: 4,
      scrollOffset: 0
    });
  });

  it("supports scrolling panels independently", () => {
    const transcript = ["one", "two", "three", "four", "five"];
    const activity = ["alpha", "beta", "gamma", "delta", "epsilon"];

    expect(selectPanelViewport(transcript, 5, "bottom", 1).lines).toEqual([
      "two",
      "three",
      "four"
    ]);
    expect(selectPanelViewport(activity, 5, "top", 2).lines).toEqual([
      "gamma",
      "delta",
      "epsilon"
    ]);
  });

  it("uses opposite scroll directions for bottom and top anchors", () => {
    expect(getNextScrollOffset("\u001b[5~", 0, 10, 4, "bottom")).toBe(4);
    expect(getNextScrollOffset("\u001b[6~", 4, 10, 4, "bottom")).toBe(0);
    expect(getNextScrollOffset("\u001b[5~", 4, 10, 4, "top")).toBe(0);
    expect(getNextScrollOffset("\u001b[6~", 0, 10, 4, "top")).toBe(4);
  });
});
