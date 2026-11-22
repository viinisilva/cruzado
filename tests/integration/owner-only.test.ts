// MCP and WhatsApp stay with the administrator while guests come in (docs/USO_COMPARTILHADO.md, decisão 6).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createUser } from "@/lib/auth/users";
import { createMcpToken, resolveMcpToken } from "@/lib/mcp/tokens";
import { createLinkCode } from "@/lib/whatsapp/link";
import { OwnerOnlyError, isOwnerId, ownerUserId } from "@/lib/auth/access";
import { testDb } from "../support/db";

describe("owner-only features", () => {
  let db: Awaited<ReturnType<typeof testDb>>;
  let owner: string;
  let guest: string;
  beforeAll(async () => {
    db = await testDb();
    owner = await createUser(db, { name: "Dona", email: "dona@exemplo.test", password: "senha-de-teste-123" });
    guest = await createUser(db, { name: "Convidado", email: "convidado@exemplo.test", password: "senha-de-teste-123" });
  });
  afterEach(() => {
    delete process.env.OWNER_USER_ID;
  });

  it("reads OWNER_USER_ID, then the older PLUGGY_OWNER_USER_ID; with neither, everyone is the owner", () => {
    expect(ownerUserId({ OWNER_USER_ID: "a", PLUGGY_OWNER_USER_ID: "b" })).toBe("a");
    expect(ownerUserId({ PLUGGY_OWNER_USER_ID: "b" })).toBe("b");
    expect(isOwnerId("x", {})).toBe(true);
    expect(isOwnerId("x", { OWNER_USER_ID: "a" })).toBe(false);
  });

  it("a guest cannot mint an MCP token nor start a WhatsApp link", async () => {
    process.env.OWNER_USER_ID = owner;
    await expect(createMcpToken(db, guest, "cli")).rejects.toBeInstanceOf(OwnerOnlyError);
    await expect(createLinkCode(db, guest)).rejects.toBeInstanceOf(OwnerOnlyError);
    await expect(createMcpToken(db, owner, "cli")).resolves.toMatchObject({ token: expect.any(String) });
  });

  it("a guest's token from before the rule opens nothing", async () => {
    const { token } = await createMcpToken(db, guest, "antigo"); // no owner configured yet
    expect(await resolveMcpToken(db, token)).not.toBeNull();
    process.env.OWNER_USER_ID = owner;
    expect(await resolveMcpToken(db, token)).toBeNull();
  });
});
