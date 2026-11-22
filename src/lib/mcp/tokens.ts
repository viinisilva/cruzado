// Revocable, user-scoped MCP tokens. Only a SHA-256 of the token is stored; the token is shown once.
import { and, eq, gt, isNull } from "drizzle-orm";
import type { DB } from "@/db/connection";
import * as s from "@/db/schema";
import { newId } from "../ids";
import { audit } from "../audit";
import { isOwnerId, OwnerOnlyError } from "../auth/access";
import { randomToken, sha256Hex } from "../auth/crypto";

export const TOKEN_PREFIX = "tst_mcp_";
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_TOKENS = 5;

export class TokenLimitError extends Error {
  constructor() {
    super(`Limite de ${MAX_ACTIVE_TOKENS} tokens ativos. Revogue um antes de criar outro.`);
  }
}

export type McpScope = "read" | "capture";

export async function createMcpToken(db: DB, userId: string, name: string, now: Date = new Date(), scope: McpScope = "read"): Promise<{ id: string; token: string }> {
  if (!isOwnerId(userId)) throw new OwnerOnlyError();
  const active = await db
    .select({ id: s.mcpTokens.id })
    .from(s.mcpTokens)
    .where(and(eq(s.mcpTokens.userId, userId), isNull(s.mcpTokens.revokedAt), gt(s.mcpTokens.expiresAt, now)));
  if (active.length >= MAX_ACTIVE_TOKENS) throw new TokenLimitError();
  const token = `${TOKEN_PREFIX}${randomToken(32)}`;
  const id = newId();
  await db.insert(s.mcpTokens).values({ id, userId, name: name.slice(0, 60) || "MCP", tokenHash: sha256Hex(token), prefix: token.slice(0, 14), scope, expiresAt: new Date(now.getTime() + TOKEN_TTL_MS) });
  await audit(db, userId, "mcp.token_created", { tokenId: id, scope });
  return { id, token };
}

export async function revokeMcpToken(db: DB, userId: string, id: string) {
  const revoked = await db
    .update(s.mcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(s.mcpTokens.id, id), eq(s.mcpTokens.userId, userId), isNull(s.mcpTokens.revokedAt)))
    .returning({ id: s.mcpTokens.id });
  if (revoked.length) await audit(db, userId, "mcp.token_revoked", { tokenId: id });
}

export async function listMcpTokens(db: DB, userId: string) {
  return db
    .select({ id: s.mcpTokens.id, name: s.mcpTokens.name, prefix: s.mcpTokens.prefix, scope: s.mcpTokens.scope, createdAt: s.mcpTokens.createdAt, lastUsedAt: s.mcpTokens.lastUsedAt, revokedAt: s.mcpTokens.revokedAt, expiresAt: s.mcpTokens.expiresAt })
    .from(s.mcpTokens)
    .where(eq(s.mcpTokens.userId, userId))
    .orderBy(s.mcpTokens.createdAt);
}

export async function userForMcpToken(db: DB, token: string, now: Date = new Date()): Promise<string | null> {
  return (await resolveMcpToken(db, token, now))?.userId ?? null;
}

/** Resolves a bearer token to its owner and scope. Revoked, expired or unknown tokens resolve to null. */
export async function resolveMcpToken(db: DB, token: string, now: Date = new Date()): Promise<{ id: string; userId: string; scope: McpScope } | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await db
    .select()
    .from(s.mcpTokens)
    .where(and(eq(s.mcpTokens.tokenHash, sha256Hex(token)), isNull(s.mcpTokens.revokedAt), gt(s.mcpTokens.expiresAt, now)));
  // A token left from before the rule, or minted by mistake, still opens nothing for anyone but the administrator.
  if (!row || !isOwnerId(row.userId)) return null;
  await db.update(s.mcpTokens).set({ lastUsedAt: new Date() }).where(eq(s.mcpTokens.id, row.id));
  return { id: row.id, userId: row.userId, scope: row.scope };
}
