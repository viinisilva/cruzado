import { getDb } from "@/db/client";
import { guard, json, publicError } from "@/lib/api";
import { ImportRequest, commitImport } from "@/lib/importer";

export const maxDuration = 60;

export async function POST(req: Request) {
  const g = await guard(req, "import");
  if (g.response) return g.response;
  const parsed = ImportRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Arquivo ou parâmetros inválidos (máximo 2 MB)." }, 400);
  try {
    return json(await commitImport(await getDb(), g.user.id, parsed.data));
  } catch (e) {
    return json({ error: publicError(e, "Falha ao importar.") }, 422);
  }
}
