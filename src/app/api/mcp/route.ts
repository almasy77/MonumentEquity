import { handleMcpRequest } from "@/lib/mcp/server";

// Remote MCP server (Streamable HTTP) for Claude. Auth is an OAuth 2.1 Bearer token
// issued by this app (see src/lib/mcp/oauth-*.ts); /api/mcp is public in proxy.ts only
// so that it can answer 401 + WWW-Authenticate itself instead of redirecting to /login.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = handleMcpRequest;
export const GET = handleMcpRequest;
export const DELETE = handleMcpRequest;
