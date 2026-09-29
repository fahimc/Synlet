import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { DomainError, type AgentToolDefinition, type Json } from "@synlet/core";

interface McpServerConfig {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly enabled?: boolean;
}

interface McpConfig {
  readonly servers: Readonly<Record<string, McpServerConfig>>;
}

interface ConnectedServer {
  readonly client: Client;
  readonly transport: StdioClientTransport;
}

function json(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export class McpClientManager {
  private config: McpConfig | undefined;
  private readonly connections = new Map<string, ConnectedServer>();

  constructor(private readonly configPath: string) {}

  async catalog(): Promise<readonly AgentToolDefinition[]> {
    const definitions: AgentToolDefinition[] = [];
    for (const [serverName] of Object.entries((await this.load()).servers)) {
      const connection = await this.connect(serverName);
      const result = await connection.client.listTools();
      for (const tool of result.tools) {
        definitions.push({
          id: `mcp.${serverName}.${tool.name}`,
          title: tool.title ?? tool.name,
          description:
            tool.description ?? `MCP tool ${tool.name} from ${serverName}`,
          inputSchema: json(tool.inputSchema),
          source: "mcp",
        });
      }
    }
    return definitions;
  }

  async execute(toolId: string, arguments_: Json): Promise<Json> {
    const match = /^mcp\.([^.]+)\.(.+)$/u.exec(toolId);
    if (!match)
      throw new DomainError("POLICY_DENIED", `Invalid MCP tool id: ${toolId}`);
    const [, serverName, toolName] = match;
    if (!serverName || !toolName)
      throw new DomainError("POLICY_DENIED", `Invalid MCP tool id: ${toolId}`);
    const connection = await this.connect(serverName);
    const argumentsObject =
      arguments_ && typeof arguments_ === "object" && !Array.isArray(arguments_)
        ? (arguments_ as Record<string, unknown>)
        : {};
    const result = await connection.client.callTool({
      name: toolName,
      arguments: argumentsObject,
    });
    return json(result);
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.connections.values()].map(({ client }) => client.close()),
    );
    this.connections.clear();
  }

  private async load(): Promise<McpConfig> {
    if (this.config) return this.config;
    const parsed: unknown = JSON.parse(await readFile(this.configPath, "utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("servers" in parsed) ||
      typeof parsed.servers !== "object" ||
      parsed.servers === null
    ) {
      throw new DomainError(
        "INVALID_OUTPUT",
        "MCP config must contain a servers object",
      );
    }
    for (const [name, entry] of Object.entries(
      parsed.servers as Record<string, unknown>,
    )) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("command" in entry) ||
        typeof entry.command !== "string" ||
        entry.command.length < 1
      ) {
        throw new DomainError(
          "INVALID_OUTPUT",
          `MCP server ${name} must define a command`,
        );
      }
    }
    const value = parsed as McpConfig;
    this.config = {
      servers: Object.fromEntries(
        Object.entries(value.servers).filter(
          ([, entry]) => entry.enabled !== false,
        ),
      ),
    };
    return this.config;
  }

  private async connect(serverName: string): Promise<ConnectedServer> {
    const current = this.connections.get(serverName);
    if (current) return current;
    const server = (await this.load()).servers[serverName];
    if (!server)
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        `Unknown MCP server: ${serverName}`,
      );
    const client = new Client({
      name: "synlet-agent-harness",
      version: "1.0.0",
    });
    const transport = new StdioClientTransport({
      command: server.command,
      args: [...(server.args ?? [])],
      cwd: server.cwd ? resolve(server.cwd) : process.cwd(),
      env: { ...process.env, ...(server.env ?? {}) } as Record<string, string>,
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
    } catch (error: unknown) {
      await client.close().catch(() => undefined);
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        `Unable to connect MCP server ${serverName}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    const connected = { client, transport };
    this.connections.set(serverName, connected);
    return connected;
  }
}
