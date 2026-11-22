// Provider-neutral chat contract. Providers only interpret intent, pick tools and write prose;
// every number they cite must come from a tool result.

export type ToolCall = { id: string; name: string; input: unknown };

export type ChatTurn =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolCalls?: ToolCall[]; /** provider-native content to replay unchanged */ raw?: unknown }
  | { role: "tool"; results: { id: string; name: string; content: string }[] };

export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };

export type CompletionRequest = { system: string; turns: ChatTurn[]; tools: ToolSpec[] };

export type Completion = { text?: string; toolCalls: ToolCall[]; raw?: unknown; refused?: boolean };

export interface AIProvider {
  readonly name: "anthropic" | "ollama" | "mock";
  /** True when data leaves this server (requires explicit user consent). */
  readonly isExternal: boolean;
  complete(req: CompletionRequest): Promise<Completion>;
}
