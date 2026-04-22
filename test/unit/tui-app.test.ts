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

  it("keeps activity panels top-aligned so the current summary stays visible", () => {
    const lines = [
      "Now: reading src/package.json",
      "Why: reading the relevant files before proposing a concrete change",
      "",
      "Agent A: GPT-5.4",
      "  session A-session-1",
      "  health ok",
      "",
      "Agent B: GPT-5.4",
      "  session B-session-1",
      "  health ok"
    ];

    expect(selectPanelViewport(lines, 6, "top")).toMatchObject({
      lines: [
        "Now: reading src/package.json",
        "Why: reading the relevant files before proposing a concrete change",
        "",
        "Agent A: GPT-5.4"
      ],
      startLine: 1,
      endLine: 4,
      totalLines: 10,
      maxOffset: 6,
      scrollOffset: 0
    });
  });

  it("supports scrolling transcript and activity panels independently", () => {
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

  it("uses opposite scroll directions for bottom-anchored transcript and top-anchored activity", () => {
    expect(getNextScrollOffset("\u001b[5~", 0, 10, 4, "bottom")).toBe(4);
    expect(getNextScrollOffset("\u001b[6~", 4, 10, 4, "bottom")).toBe(0);
    expect(getNextScrollOffset("\u001b[5~", 4, 10, 4, "top")).toBe(0);
    expect(getNextScrollOffset("\u001b[6~", 0, 10, 4, "top")).toBe(4);
  });
});
