import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";

import { parseReplCommand, type ReplCliOptions } from "./cli.js";
import { Coordinator } from "../coordinator/coordinator.js";

export interface ReplCoordinatorLike {
  start(): Promise<void>;
  submitUserTask(text: string): Promise<string>;
  getStatus(): Record<string, unknown>;
  getSessions(): unknown;
  getLastHandoff(): Promise<unknown>;
  replaceRuntime(
    role: "A" | "B",
    action: { type: "new"; role: "A" | "B" } | { type: "switch"; role: "A" | "B"; sessionPath: string }
  ): Promise<void>;
  dispose(): Promise<void>;
}

export interface ReplReadlineLike {
  question(prompt: string): Promise<string>;
  close(): void;
}

export interface BootstrapReplDependencies {
  createCoordinator?(options: ReplCliOptions): ReplCoordinatorLike;
  createReadline?(): ReplReadlineLike;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
}

export async function bootstrapRepl(
  options: ReplCliOptions,
  dependencies: BootstrapReplDependencies = {}
): Promise<void> {
  const coordinator =
    dependencies.createCoordinator?.(options) ?? new Coordinator(options);
  await coordinator.start();

  const rl = dependencies.createReadline?.() ?? createInterface({
    input: stdin,
    output: stdout
  });

  await runReplLoop(coordinator, rl, {
    stdout: dependencies.stdout ?? stdout,
    stderr: dependencies.stderr ?? stderr
  });
}

export async function runReplLoop(
  coordinator: ReplCoordinatorLike,
  rl: ReplReadlineLike,
  io: {
    stdout: Pick<NodeJS.WriteStream, "write">;
    stderr: Pick<NodeJS.WriteStream, "write">;
  }
): Promise<void> {
  try {
    let running = true;
    while (running) {
      let input: string;
      try {
        input = await rl.question("pi-dual> ");
      } catch (error) {
        if (isReplTerminationError(error)) {
          break;
        }
        throw error;
      }

      try {
        const command = parseReplCommand(input);

        switch (command.type) {
          case "task": {
            if (!command.text) {
              break;
            }
            const result = await coordinator.submitUserTask(command.text);
            io.stdout.write(`${result}\n`);
            break;
          }
          case "status":
            io.stdout.write(`${JSON.stringify(coordinator.getStatus(), null, 2)}\n`);
            break;
          case "sessions":
            io.stdout.write(`${JSON.stringify(coordinator.getSessions(), null, 2)}\n`);
            break;
          case "handoff":
            io.stdout.write(`${JSON.stringify(await coordinator.getLastHandoff(), null, 2)}\n`);
            break;
          case "new":
            await coordinator.replaceRuntime(command.role, command);
            io.stdout.write(`Created new session for role ${command.role}\n`);
            break;
          case "switch":
            await coordinator.replaceRuntime(command.role, command);
            io.stdout.write(`Switched role ${command.role} to ${command.sessionPath}\n`);
            break;
          case "quit":
            running = false;
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        io.stderr.write(`Error: ${message}\n`);
      }
    }
  } finally {
    rl.close();
    await coordinator.dispose();
  }
}

export function isReplTerminationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
  return (
    code === "ERR_USE_AFTER_CLOSE" ||
    error.name === "AbortError" ||
    error.message.includes("readline was closed")
  );
}
