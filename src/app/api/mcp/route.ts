// MCP endpoint (Streamable HTTP, stateless). Auth: Authorization: Bearer <revocable user token>; the token's scope picks the tools.
import { getDb } from "@/db/client";
import { handleMcpRequest } from "@/lib/mcp/server";
import { resolveMcpToken } from "@/lib/mcp/tokens";
import { clientIp, rateLimitShared, tooMany } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function unauthorized() {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Token MCP ausente, inválido ou revogado." }, id: null }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="cruzado-mcp"', "cache-control": "no-store" },
  });
}

async function handle(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return unauthorized();
  // Before the token lookup, and shared by every instance, so guessing tokens is slow everywhere.
  const db = await getDb();
  const byIp = await rateLimitShared(db, "mcpAuth", clientIp(req.headers));
  if (!byIp.ok) return tooMany(byIp.retryAfterSec);
  const owner = await resolveMcpToken(db, token);
  if (!owner) return unauthorized();
  const rl = await rateLimitShared(db, "mcp", owner.userId);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const res = await handleMcpRequest(db, owner.userId, req, owner.scope, owner.id);
  // Financial data: copied into a new Response because the transport's headers may be immutable.
  const headers = new Headers(res.headers);
  headers.set("cache-control", "no-store");
  return new Response(res.body, { status: res.status, headers });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
