import { execFile } from "node:child_process";
import { resolve } from "node:path";

import {
  DomainError,
  type AgentToolDefinition,
  type AgentToolPort,
  type Json,
} from "@synlet/core";

import type { PlaywrightBrowserAdapter } from "../browser/playwright-browser.js";
import type { McpClientManager } from "../mcp/mcp-client-manager.js";
import type { SafeToolAdapter } from "./safe-tools.js";

function objectArguments(value: Json): Record<string, Json> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_OUTPUT", "Tool arguments must be an object");
  }
  return value as Record<string, Json>;
}

function textArgument(value: Record<string, Json>, key: string): string {
  const found = value[key];
  if (typeof found !== "string")
    throw new DomainError("INVALID_OUTPUT", `${key} must be a string`);
  return found;
}

const hostTools: readonly AgentToolDefinition[] = [
  {
    id: "file.read",
    title: "Read workspace file",
    description:
      "Read a UTF-8 file in the configured workspace and return its revision hash.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    source: "host",
  },
  {
    id: "file.patch",
    title: "Write workspace file",
    description:
      "Atomically replace a UTF-8 workspace file when expectedSha256 matches.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        expectedSha256: { type: "string" },
      },
      required: ["path", "content", "expectedSha256"],
    },
    source: "host",
  },
  {
    id: "calculator",
    title: "Calculator",
    description: "Evaluate a bounded arithmetic expression.",
    inputSchema: {
      type: "object",
      properties: { expression: { type: "string" } },
      required: ["expression"],
    },
    source: "host",
  },
  {
    id: "command.run",
    title: "Run host shell command",
    description:
      "Run an arbitrary non-interactive command through the host's native shell (PowerShell on Windows or /bin/sh on POSIX) with full launch-user filesystem, process, environment, and network access. Commands are not allowlisted or restricted to the workspace. Inspect the host before choosing OS-specific commands. Returns host/shell identity, exit code, stdout, and stderr.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["command"],
    },
    source: "host",
  },
  {
    id: "browser.search",
    title: "Search the web",
    description:
      "Search the live web and return result titles, links, and descriptions. Search results are discovery evidence; if they are only directories or do not contain the requested facts, continue with another query, open a result, or use the shell to retrieve source content.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    source: "browser",
  },
  {
    id: "browser.inspect",
    title: "Open web page",
    description:
      "Open any HTTP(S) URL in the dedicated automated Edge profile and return title and rendered text.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    source: "browser",
  },
  {
    id: "browser.click",
    title: "Click web page",
    description:
      "Open a URL, click an exact accessible button or link name, and return the resulting rendered page.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        role: { enum: ["button", "link"] },
        name: { type: "string" },
      },
      required: ["url", "role", "name"],
    },
    source: "browser",
  },
  {
    id: "browser.type",
    title: "Type into web page",
    description:
      "Open a URL, fill an exact accessible textbox label, optionally press Enter, and return the resulting rendered page.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        label: { type: "string" },
        value: { type: "string" },
        submit: { type: "boolean" },
      },
      required: ["url", "label", "value"],
    },
    source: "browser",
  },
];

export class AgentToolRouter implements AgentToolPort {
  constructor(
    private readonly safeTools: SafeToolAdapter,
    private readonly browser: PlaywrightBrowserAdapter,
    private readonly mcp: McpClientManager,
    private readonly defaultCwd: string,
  ) {}

  async catalog(): Promise<readonly AgentToolDefinition[]> {
    return [...hostTools, ...(await this.mcp.catalog())];
  }

  async execute(
    toolId: string,
    arguments_: Json,
    signal?: AbortSignal,
  ): Promise<Json> {
    if (
      toolId === "file.read" ||
      toolId === "file.patch" ||
      toolId === "calculator"
    ) {
      return this.safeTools.execute(toolId, arguments_);
    }
    const args = objectArguments(arguments_);
    if (toolId === "command.run") return this.command(args, signal);
    if (toolId === "browser.search")
      return this.browser.search(textArgument(args, "query"));
    if (toolId === "browser.inspect")
      return this.browser.inspect(textArgument(args, "url"));
    if (toolId === "browser.click") {
      const role = textArgument(args, "role");
      if (role !== "button" && role !== "link")
        throw new DomainError("INVALID_OUTPUT", "role must be button or link");
      return this.browser.clickAndObserve(
        textArgument(args, "url"),
        role,
        textArgument(args, "name"),
      );
    }
    if (toolId === "browser.type") {
      return this.browser.typeAndObserve(
        textArgument(args, "url"),
        textArgument(args, "label"),
        textArgument(args, "value"),
        args.submit === true,
      );
    }
    if (toolId.startsWith("mcp.")) return this.mcp.execute(toolId, arguments_);
    throw new DomainError("POLICY_DENIED", `Unsupported agent tool: ${toolId}`);
  }

  async close(): Promise<void> {
    await this.mcp.close();
  }

  private command(
    args: Record<string, Json>,
    signal?: AbortSignal,
  ): Promise<Json> {
    const command = textArgument(args, "command");
    if (command.length > 16_384)
      throw new DomainError("RESOURCE_EXHAUSTED", "Command is too long");
    const cwdValue = args.cwd;
    const cwd =
      typeof cwdValue === "string" ? resolve(cwdValue) : this.defaultCwd;
    const requestedTimeout =
      typeof args.timeoutMs === "number" ? args.timeoutMs : 120_000;
    const timeout = Math.max(1_000, Math.min(600_000, requestedTimeout));
    const executable =
      process.platform === "win32" ? "powershell.exe" : "/bin/sh";
    const commandArgs =
      process.platform === "win32"
        ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
        : ["-lc", command];
    return new Promise((resolvePromise, reject) => {
      execFile(
        executable,
        commandArgs,
        { cwd, timeout, maxBuffer: 1024 * 1024, windowsHide: true, signal },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== "number") {
            reject(
              new DomainError(
                "INVALID_OUTPUT",
                `Command failed: ${error.message}\n${stderr}`.slice(0, 16_384),
              ),
            );
            return;
          }
          const diagnostic = shellDiagnostic(stderr);
          const complete = (installedSyntax?: string) => {
            resolvePromise({
              ok: !error && !diagnostic,
              platform: process.platform,
              shell: process.platform === "win32" ? "powershell" : "/bin/sh",
              command,
              cwd,
              exitCode:
                error && typeof error.code === "number" ? error.code : 0,
              stdout: stdout.slice(0, 65_536),
              stderr: stderr.slice(0, 65_536),
              ...(diagnostic ? { diagnostic } : {}),
              ...(installedSyntax ? { installedSyntax } : {}),
            });
          };
          const commandName = powerShellCommandName(command);
          if (
            error &&
            diagnostic &&
            process.platform === "win32" &&
            commandName
          ) {
            execFile(
              executable,
              [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                `Get-Command -Name ${commandName} -Syntax`,
              ],
              {
                cwd,
                timeout: 10_000,
                maxBuffer: 64 * 1024,
                windowsHide: true,
                signal,
              },
              (syntaxError, syntaxStdout) => {
                complete(syntaxError ? undefined : syntaxStdout.slice(0, 8192));
              },
            );
            return;
          }
          complete();
        },
      );
    });
  }
}

function shellDiagnostic(stderr: string): string | undefined {
  if (/parameter (?:cannot be found|name)/iu.test(stderr)) {
    return "The shell is available but the command syntax is invalid. Inspect the installed command with Get-Command -Syntax or Get-Help before retrying with different parameters.";
  }
  if (
    /is not recognized as the name of a cmdlet|CommandNotFoundException/iu.test(
      stderr,
    )
  ) {
    return "The requested command is unavailable in this shell. Use Get-Command/Get-Help or choose another installed method.";
  }
  if (stderr.trim()) {
    return "The shell ran the command but its arguments, target, provider, or requested resource failed. Inspect the installed command syntax/help and enumerate available targets before retrying.";
  }
  return undefined;
}

function powerShellCommandName(command: string): string | undefined {
  return /^\s*([A-Za-z]+-[A-Za-z][A-Za-z0-9-]*)\b/u.exec(command)?.[1];
}
