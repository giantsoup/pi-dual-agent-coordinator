import { spawn } from "node:child_process";

export interface BrowserOpenResult {
  status: "opened" | "failed" | "unsupported";
}

export async function openUrlInBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform
): Promise<BrowserOpenResult> {
  const command = getBrowserCommand(platform, url);
  if (!command) {
    return {
      status: "unsupported"
    };
  }

  return await new Promise<BrowserOpenResult>((resolve) => {
    let settled = false;
    const child = spawn(command.command, command.args, {
      detached: platform !== "win32",
      stdio: "ignore"
    });

    const finish = (status: BrowserOpenResult["status"]) => {
      if (settled) {
        return;
      }
      settled = true;
      child.unref();
      resolve({ status });
    };

    child.once("error", () => {
      finish("failed");
    });

    child.once("close", (code) => {
      finish(code === 0 ? "opened" : "failed");
    });
  });
}

function getBrowserCommand(
  platform: NodeJS.Platform,
  url: string
): { command: string; args: string[] } | undefined {
  if (platform === "darwin") {
    return {
      command: "open",
      args: [url]
    };
  }

  if (platform === "win32") {
    return {
      command: "cmd",
      args: ["/c", "start", "", url]
    };
  }

  if (platform === "linux") {
    return {
      command: "xdg-open",
      args: [url]
    };
  }

  return undefined;
}
