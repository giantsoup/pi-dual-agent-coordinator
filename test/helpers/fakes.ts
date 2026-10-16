import { join } from "node:path";

import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";

import type {
  RoleRuntimeBinding,
  RuntimeLike,
  SessionLike
} from "../../src/runtime/create-role-runtime.js";
import type { RoleMcpStatusSnapshot } from "../../src/mcp/types.js";
import type { Role } from "../../src/types/role.js";

export class FakeSession implements SessionLike {
  public readonly prompts: string[] = [];
  public readonly listeners = new Set<(event: AgentSessionEvent) => void>();
  public bindExtensionsCalls = 0;
  public unsubscribeCalls = 0;
  public isStreaming = false;
  public thinkingLevel = "medium";
  public model = undefined;
  public messages: AgentMessage[] = [];
  public sessionManager = {
    getLeafId: () => `${this.sessionId}-leaf`
  };

  public constructor(
    public readonly sessionId: string,
    public readonly sessionFile: string | undefined,
    private readonly promptHandler?: (
      text: string,
      options?: { streamingBehavior?: "steer" | "followUp"; preflightResult?: (success: boolean) => void }
    ) => Promise<void>
  ) {}

  public async bindExtensions(_bindings?: Record<string, never>): Promise<void> {
    this.bindExtensionsCalls += 1;
  }

  public subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.unsubscribeCalls += 1;
      this.listeners.delete(listener);
    };
  }

  public async prompt(
    text: string,
    options?: { streamingBehavior?: "steer" | "followUp"; preflightResult?: (success: boolean) => void }
  ): Promise<void> {
    this.prompts.push(text);
    options?.preflightResult?.(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await this.promptHandler?.(text, options);
  }

  public async emit(event: AgentSessionEvent): Promise<void> {
    for (const listener of this.listeners) {
      await listener(event);
    }
  }

  public async abort(): Promise<void> {}

  public dispose(): void {}
}

export class FakeRuntime implements RuntimeLike {
  public diagnostics: readonly unknown[] = [];
  public createdSessions: FakeSession[] = [];
  public newSessionCount = 0;
  public switchSessionCount = 0;
  public disposeCount = 0;

  public constructor(
    public readonly cwd: string,
    public session: FakeSession,
    private readonly role: Role
  ) {
    this.createdSessions.push(session);
  }

  public async newSession(): Promise<{ cancelled: boolean }> {
    this.newSessionCount += 1;
    this.session = new FakeSession(
      `${this.role}-new-${this.newSessionCount}`,
      join(this.cwd, `${this.role}-new-${this.newSessionCount}.jsonl`)
    );
    this.createdSessions.push(this.session);
    return { cancelled: false };
  }

  public async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    this.switchSessionCount += 1;
    this.session = new FakeSession(`${this.role}-switch-${this.switchSessionCount}`, sessionPath);
    this.createdSessions.push(this.session);
    return { cancelled: false };
  }

  public async dispose(): Promise<void> {
    this.disposeCount += 1;
  }
}

export function createFakeBinding(
  role: Role,
  runtime: FakeRuntime,
  mcpStatus?: RoleMcpStatusSnapshot
): RoleRuntimeBinding {
  return {
    role,
    runtime,
    get session() {
      return runtime.session;
    },
    get sessionId() {
      return runtime.session.sessionId;
    },
    get sessionFile() {
      return runtime.session.sessionFile;
    },
    cwd: runtime.cwd,
    getMcpStatus() {
      return mcpStatus ?? {
        role,
        enabled: false,
        servers: []
      };
    },
    async rebind() {
      this.cwd = runtime.cwd;
      await runtime.session.bindExtensions?.({});
    },
    async dispose() {
      runtime.session.dispose();
      await runtime.dispose();
    }
  };
}

export function assistantTurnEnd(text: string): AgentSessionEvent {
  return {
    type: "turn_end",
    message: assistantMessage(text),
    toolResults: []
  };
}

export function assistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5.4-mini",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0
      }
    },
    stopReason: "stop",
    timestamp: Date.now()
  };
}
