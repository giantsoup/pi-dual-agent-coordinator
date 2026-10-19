import { expect, it } from "vitest";
import { parseReplCommand } from "../../src/app/cli.js";

it("routes skill requests through an operator turn rather than execution approval", () => {
  expect(parseReplCommand("/skills")).toEqual({ type: "user_turn", text: expect.stringContaining("installed Pi skills") });
  expect(parseReplCommand("/skill:tdd fix arithmetic")).toEqual({ type: "user_turn", text: expect.stringContaining("tdd") });
  expect(parseReplCommand("/skill:implement").type).toBe("user_turn");
  expect(() => parseReplCommand("/skill:../../auth.json")).toThrow("Unknown REPL command");
});
