import { describe, expect, it } from "vitest";

import {
  renderConfigSaveNotice,
  renderNoticeText,
  renderRecoveryNotice,
  renderStartupInstructions,
  renderThreadLaunchNotice
} from "../../src/app/presentation/notices.js";

describe("presentation notices", () => {
  it("renders startup instructions with clear next steps", () => {
    const output = renderStartupInstructions({
      browserOpenStatus: "failed",
      healthCheckUrl: "http://127.0.0.1:4317/healthz",
      launchUrl: "http://127.0.0.1:4317/?token=secret-token",
      projectPath: "/tmp/project"
    });

    expect(output.lines).toEqual(
      expect.arrayContaining([
        "PI Dual web interface is ready.",
        "Open this link in any browser on this computer: http://127.0.0.1:4317/?token=secret-token",
        "If the link does not open automatically, copy and paste it into Chrome, Safari, Firefox, or another local browser.",
        "This interface is only available on this machine because the server listens on localhost.",
        "Project loaded: /tmp/project"
      ])
    );
  });

  it("includes restart guidance in config save notices", () => {
    const notice = renderConfigSaveNotice({
      activeThreadsNeedRestart: true,
      scope: "project",
      targetName: "/tmp/project"
    });

    expect(notice.message).toContain("project settings");
    expect(notice.nextStep).toContain("restart active threads");
  });

  it("includes project, model, and first action in thread launch notices", () => {
    const notice = renderThreadLaunchNotice({
      firstAction: "Agent A is preparing the implementation plan",
      modelA: "openai/gpt-5.4",
      modelB: "local-qwen/qwen3-coder-next",
      projectPath: "/tmp/project"
    });

    expect(notice.message).toContain("openai/gpt-5.4");
    expect(notice.message).toContain("local-qwen/qwen3-coder-next");
    expect(notice.message).toContain("/tmp/project");
    expect(notice.nextStep).toContain("First step");
  });

  it("explains recovery actions plainly", () => {
    const notice = renderRecoveryNotice({
      projectPath: "/tmp/project",
      resumable: true
    });

    expect(renderNoticeText(notice)).toContain("Resume it");
    expect(renderNoticeText(notice)).toContain("/tmp/project");
  });
});
