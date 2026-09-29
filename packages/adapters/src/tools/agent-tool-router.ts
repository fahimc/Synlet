import { Ajv } from "ajv";
import {
  DomainError,
  type AgentToolDefinition,
  type AgentToolPort,
  type Json,
} from "@synlet/core";
import type { PlaywrightBrowserAdapter } from "../browser/playwright-browser.js";
import type { McpClientManager } from "../mcp/mcp-client-manager.js";
import type { SafeToolAdapter } from "./safe-tools.js";
import { FullControlFiles } from "./full-control-files.js";
import { runHostCommand } from "./host-command.js";
const hostTools: readonly AgentToolDefinition[] = [
  {
    id: "file.read",
    title: "Read host file",
    description:
      "Read a UTF-8 file at any launch-user-accessible path and return its revision hash.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    source: "host",
  },
  {
    id: "file.patch",
    title: "Write host file",
    description:
      "Atomically replace a UTF-8 host file when expectedSha256 matches.",
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
        shell: { enum: ["powershell", "cmd", "posix"] },
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

const additional: readonly AgentToolDefinition[] = [
  {
    id: "file.write",
    title: "Write any host file",
    description:
      "Create or replace a launch-user-accessible file, including absolute paths outside the workspace. This is intentionally unrestricted.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
    source: "host",
  },
  {
    id: "file.delete",
    title: "Delete host path",
    description:
      "Delete a file or directory accessible to the launch user. recursive/force are explicit arguments. No workspace boundary.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
        force: { type: "boolean" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    source: "host",
  },
  {
    id: "image.open",
    title: "Read image from host",
    description:
      "Read an image at any accessible path and provide its real pixels to the vision specialist.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    source: "host",
  },
  {
    id: "browser.screenshot",
    title: "Capture browser image",
    description:
      "Capture actual pixels of the dedicated browser; returns an image reference for vision.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    source: "browser",
  },
];
export class AgentToolRouter implements AgentToolPort {
  private readonly files: FullControlFiles;
  private readonly validator = new Ajv({
    strict: false,
    allErrors: true,
    validateFormats: false,
  });
  constructor(
    private readonly safeTools: SafeToolAdapter,
    private readonly browser: PlaywrightBrowserAdapter,
    private readonly mcp: McpClientManager,
    private readonly defaultCwd: string,
  ) {
    this.files = new FullControlFiles(defaultCwd);
  }
  async catalog(): Promise<readonly AgentToolDefinition[]> {
    return [...hostTools, ...additional, ...(await this.mcp.catalog())];
  }
  async execute(
    toolId: string,
    arguments_: Json,
    signal?: AbortSignal,
  ): Promise<Json> {
    signal?.throwIfAborted();
    const definition = (await this.catalog()).find(
      (tool) => tool.id === toolId,
    );
    if (!definition)
      throw new DomainError("INVALID_OUTPUT", `Unknown tool: ${toolId}`);
    const valid = this.validator.compile(definition.inputSchema as object);
    if (!valid(arguments_))
      throw new DomainError(
        "INVALID_OUTPUT",
        `Tool arguments violate schema: ${this.validator.errorsText(valid.errors)}`,
      );
    if (
      !arguments_ ||
      typeof arguments_ !== "object" ||
      Array.isArray(arguments_)
    )
      throw new DomainError(
        "INVALID_OUTPUT",
        "Tool arguments must be an object",
      );
    const args = arguments_ as Record<string, Json>;
    const text = (key: string) => {
      const value = args[key];
      if (typeof value !== "string")
        throw new DomainError("INVALID_OUTPUT", `${key} must be a string`);
      return value;
    };
    if (toolId.startsWith("file.") || toolId === "image.open")
      return this.files.execute(toolId, args, signal);
    if (toolId === "calculator") return this.safeTools.execute(toolId, args);
    if (toolId === "command.run")
      return runHostCommand(args, this.defaultCwd, signal);
    if (toolId === "browser.search")
      return this.browser.search(text("query"), signal);
    if (toolId === "browser.inspect")
      return this.browser.inspect(text("url"), signal);
    if (toolId === "browser.screenshot")
      return this.browser.screenshot(text("url"), signal);
    if (toolId === "browser.click")
      return this.browser.clickAndObserve(
        text("url"),
        text("role") as "button" | "link",
        text("name"),
        signal,
      );
    if (toolId === "browser.type")
      return this.browser.typeAndObserve(
        text("url"),
        text("label"),
        text("value"),
        args.submit === true,
        signal,
      );
    if (toolId.startsWith("mcp."))
      return this.mcp.execute(toolId, args, signal);
    throw new DomainError("INVALID_OUTPUT", "Tool has no adapter");
  }
  async close(): Promise<void> {
    await this.browser.close();
    await this.mcp.close();
  }
}
