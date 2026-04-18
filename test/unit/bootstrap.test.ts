import { describe, expect, it } from "vitest";

import {
  isReplTerminationError,
  runReplLoop,
  type ReplCoordinatorLike,
  type ReplReadlineLike
} from "../../src/app/bootstrap.js";

class FakeReadline implements ReplReadlineLike {
  public closeCalls = 0;
  private index = 0;

  public constructor(
    private readonly responses: Array<string | Error>
  ) {}

  public async question(_prompt: string): Promise<string> {
    const response = this.responses[this.index++];
    if (response instanceof Error) {
      throw response;
    }
    return response ?? "/quit";
  }

  public close(): void {
    this.closeCalls += 1;
  }
}

function createCoordinator(): ReplCoordinatorLike & {
  readonly disposeCalls: number;
} {
  let disposeCalls = 0;

  return {
    async start() {},
    async submitUserTask(text: string) {
      return `submitted:${text}`;
    },
    getStatus() {
      return { ok: true };
    },
    getSessions() {
      return [];
    },
    async getLastHandoff() {
      return { state: { records: [] } };
    },
    async replaceRuntime() {},
    async dispose() {
      disposeCalls += 1;
    },
    get disposeCalls() {
      return disposeCalls;
    }
  };
}

describe("bootstrap repl", () => {
  it("exits cleanly when the readline interface closes", async () => {
    const closed = Object.assign(new Error("readline was closed"), {
      code: "ERR_USE_AFTER_CLOSE"
    });
    const rl = new FakeReadline(["/status", closed]);
    const coordinator = createCoordinator();
    const writes: string[] = [];

    await expect(
      runReplLoop(coordinator, rl, {
        stdout: { write: (chunk: string) => { writes.push(chunk); return true; } },
        stderr: { write: (_chunk: string) => true }
      })
    ).resolves.toBeUndefined();

    expect(writes.join("")).toContain('"ok": true');
    expect(coordinator.disposeCalls).toBe(1);
    expect(rl.closeCalls).toBe(1);
  });

  it("recognizes readline termination errors", () => {
    expect(
      isReplTerminationError(
        Object.assign(new Error("readline was closed"), {
          code: "ERR_USE_AFTER_CLOSE"
        })
      )
    ).toBe(true);
    expect(isReplTerminationError(new Error("boom"))).toBe(false);
  });
});
