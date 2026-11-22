// Who may enter this instance at all. Once an owner is configured the database holds real bank data, so the public
// doors start closed: forgetting a variable must never leave them open. ALLOW_*=1 reopens one explicitly.
type Env = Record<string, string | undefined>;

const open = (flag: string | undefined, env: Env) => flag === "1" || (flag !== "0" && !env.PLUGGY_OWNER_USER_ID);

export const signupOpen = (env: Env = process.env) => open(env.ALLOW_SIGNUP, env);
export const demoOpen = (env: Env = process.env) => open(env.ALLOW_DEMO, env);

/** The administrator: the person who runs this instance. OWNER_USER_ID, or the older PLUGGY_OWNER_USER_ID. */
export const ownerUserId = (env: Env = process.env): string | null => env.OWNER_USER_ID || env.PLUGGY_OWNER_USER_ID || null;

/**
 * Features that hand out lasting access or write from outside (MCP tokens, WhatsApp) are the administrator's only,
 * until there is a reason to open them (docs/USO_COMPARTILHADO.md, decisão 6). With no owner configured, the instance
 * belongs to whoever runs it, as before.
 */
export const isOwnerId = (userId: string, env: Env = process.env): boolean => {
  const owner = ownerUserId(env);
  return !owner || owner === userId;
};

export class OwnerOnlyError extends Error {
  constructor() {
    super("Disponível só para quem administra o app.");
  }
}
