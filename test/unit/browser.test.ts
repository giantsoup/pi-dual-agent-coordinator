import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

import { openUrlInBrowser } from "../../src/app/browser.js";

describe("openUrlInBrowser", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("returns unsupported when the platform has no known opener", async () => {
    await expect(openUrlInBrowser("http://127.0.0.1:4317", "aix")).resolves.toEqual({
      status: "unsupported"
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns opened when the opener exits successfully", async () => {
    spawnMock.mockImplementation(() => createChild(0));

    await expect(openUrlInBrowser("http://127.0.0.1:4317", "linux")).resolves.toEqual({
      status: "opened"
    });
  });

  it("returns failed when the opener exits with an error code", async () => {
    spawnMock.mockImplementation(() => createChild(1));

    await expect(openUrlInBrowser("http://127.0.0.1:4317", "linux")).resolves.toEqual({
      status: "failed"
    });
  });

  it("returns failed when spawning the opener itself fails", async () => {
    spawnMock.mockImplementation(() => createChild(undefined, new Error("spawn failed")));

    await expect(openUrlInBrowser("http://127.0.0.1:4317", "linux")).resolves.toEqual({
      status: "failed"
    });
  });
});

function createChild(
  exitCode?: number,
  error?: Error
): EventEmitter & { unref: ReturnType<typeof vi.fn> } {
  const child = new EventEmitter() as EventEmitter & {
    unref: ReturnType<typeof vi.fn>;
  };
  child.unref = vi.fn();

  queueMicrotask(() => {
    if (error) {
      child.emit("error", error);
      return;
    }
    child.emit("close", exitCode);
  });

  return child;
}
