import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

serveStdio(() => {
  const server = new McpServer({
    name: "synlet-bundled-tools",
    version: "1.0.0",
  });
  server.registerTool(
    "echo",
    {
      title: "Echo",
      description: "Return text through a real MCP stdio round trip.",
      inputSchema: z.object({ text: z.string().max(4096) }),
    },
    async ({ text }) => ({
      content: [{ type: "text", text }],
      structuredContent: { text },
    }),
  );
  server.registerTool(
    "runtime_info",
    {
      title: "Runtime information",
      description: "Return the MCP server process and platform information.",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            platform: process.platform,
            node: process.version,
            pid: process.pid,
          }),
        },
      ],
      structuredContent: {
        platform: process.platform,
        node: process.version,
        pid: process.pid,
      },
    }),
  );
  return server;
});
