import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpRequest, type McpAuthContext } from "./auth";
import { SERVER_INSTRUCTIONS, registerTools } from "./tools";

export function createMcpServer(ctx: McpAuthContext): McpServer {
  const server = new McpServer(
    { name: "monument-equity", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS }
  );
  registerTools(server, ctx);
  return server;
}

/**
 * Handle one Streamable-HTTP request. Stateless: a fresh server + transport per
 * request (no session ids, plain JSON responses), which is what a serverless
 * deployment needs. Authentication happens first; nothing below runs without it.
 */
export async function handleMcpRequest(req: Request): Promise<Response> {
  const authResult = await authenticateMcpRequest(req);
  if (!authResult.ok) return authResult.response;

  if (req.method !== "POST") {
    // No server-initiated streams or sessions in stateless mode.
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST" },
    });
  }

  const server = createMcpServer(authResult.ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Response bodies are fully materialised (JSON mode), so it is safe to tear down.
    void transport.close().catch(() => undefined);
    void server.close().catch(() => undefined);
  }
}
