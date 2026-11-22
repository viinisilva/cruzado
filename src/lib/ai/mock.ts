// Deterministic provider for demo mode and tests. Same input → same tool calls → same answer.
import { newId } from "../ids";
import { parseIntent } from "./mock-intent";
import type { AIProvider, Completion, CompletionRequest } from "./types";

export type MockContext = { today: string; categories: { name: string; slug: string; kind: string }[] };

export class MockProvider implements AIProvider {
  readonly name = "mock" as const;
  readonly isExternal = false;

  constructor(private ctx: () => MockContext) {}

  async complete(req: CompletionRequest): Promise<Completion> {
    const last = req.turns[req.turns.length - 1];
    if (last?.role === "tool") {
      // Second step: render the tools' deterministic facts.
      let clarification = false;
      const facts = last.results.map((r) => {
        try {
          const parsed = JSON.parse(r.content) as { facts?: string; data?: { needsClarification?: string; error?: string } };
          if (parsed.data?.needsClarification || parsed.data?.error) clarification = true;
          return parsed.facts ?? "";
        } catch {
          return "";
        }
      });
      const body = facts.filter(Boolean).join("\n\n");
      return { text: clarification ? body : `Fatos calculados:\n${body}`, toolCalls: [] };
    }
    const lastUser = [...req.turns].reverse().find((t) => t.role === "user");
    if (!lastUser || lastUser.role !== "user") return { text: "Como posso ajudar?", toolCalls: [] };
    const intent = parseIntent(lastUser.text, this.ctx());
    if ("clarify" in intent) return { text: intent.clarify, toolCalls: [] };
    return { toolCalls: intent.calls.map((c) => ({ id: newId(), name: c.name, input: c.input })) };
  }
}
