import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, ChatTurn, Completion, CompletionRequest } from "./types";

// The model is configuration, not code: set ANTHROPIC_MODEL to move to a newer model without a release.
const DEFAULT_MODEL = "claude-opus-5-5";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic" as const;
  readonly isExternal = true;
  private client: Anthropic;
  private model: string;
  private effort: Effort;

  constructor(opts: { apiKey?: string; model?: string; effort?: Effort } = {}) {
    // Credentials resolve from the environment (ANTHROPIC_API_KEY etc.); never from user input.
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.model = opts.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    this.effort = opts.effort ?? ((process.env.ANTHROPIC_EFFORT as Effort | undefined) ?? "medium");
  }

  private toMessages(turns: ChatTurn[]): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = [];
    for (const t of turns) {
      if (t.role === "user") out.push({ role: "user", content: t.text });
      else if (t.role === "assistant") {
        // Replay the provider's own content blocks (incl. thinking) unchanged inside the tool loop.
        if (t.raw) out.push({ role: "assistant", content: t.raw as Anthropic.ContentBlockParam[] });
        else if (t.text) out.push({ role: "assistant", content: t.text });
      } else {
        out.push({
          role: "user",
          content: t.results.map((r) => ({ type: "tool_result" as const, tool_use_id: r.id, content: r.content })),
        });
      }
    }
    return out;
  }

  async complete(req: CompletionRequest): Promise<Completion> {
    const params = {
      model: this.model,
      max_tokens: 16000,
      system: req.system,
      output_config: { effort: this.effort },
      tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
      tool_choice: { type: "auto" as const },
      messages: this.toMessages(req.turns),
      // Server-side fallback if the primary model declines (routes by refusal category).
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    };
    const res = (await this.client.beta.messages.create(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming)) as unknown as Anthropic.Message;
    if (res.stop_reason === "refusal") return { refused: true, toolCalls: [], text: undefined };
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const toolCalls = res.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));
    return { text: text || undefined, toolCalls, raw: res.content };
  }
}
