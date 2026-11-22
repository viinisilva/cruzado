// Local models through Ollama's /api/chat (tool calling). Data stays on your machine/network.
import { newId } from "../ids";
import type { AIProvider, ChatTurn, Completion, CompletionRequest } from "./types";

type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { function: { name: string; arguments: unknown } }[];
  tool_name?: string;
};

export class OllamaProvider implements AIProvider {
  readonly name = "ollama" as const;
  readonly isExternal: boolean;
  private baseUrl: string;
  private model: string;

  constructor(opts: { baseUrl?: string; model?: string } = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
    this.model = opts.model ?? process.env.OLLAMA_MODEL ?? "qwen3:8b";
    // A remote Ollama host is still a third party from the user's point of view.
    const host = new URL(this.baseUrl).hostname;
    this.isExternal = !["127.0.0.1", "localhost", "::1", "ollama"].includes(host);
  }

  private toMessages(system: string, turns: ChatTurn[]): OllamaMessage[] {
    const out: OllamaMessage[] = [{ role: "system", content: system }];
    for (const t of turns) {
      if (t.role === "user") out.push({ role: "user", content: t.text });
      else if (t.role === "assistant")
        out.push({ role: "assistant", content: t.text ?? "", tool_calls: t.toolCalls?.map((c) => ({ function: { name: c.name, arguments: c.input } })) });
      else for (const r of t.results) out.push({ role: "tool", content: r.content, tool_name: r.name });
    }
    return out;
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: this.toMessages(req.system, req.turns),
        tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Ollama respondeu ${res.status}`);
    const body = (await res.json()) as { message?: OllamaMessage };
    const msg = body.message;
    const toolCalls = (msg?.tool_calls ?? []).map((c) => ({
      id: newId(),
      name: c.function.name,
      input: typeof c.function.arguments === "string" ? safeJson(c.function.arguments) : c.function.arguments,
    }));
    return { text: msg?.content?.trim() || undefined, toolCalls };
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
