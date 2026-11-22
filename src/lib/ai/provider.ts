import { AnthropicProvider } from "./anthropic";
import { MockProvider, type MockContext } from "./mock";
import { OllamaProvider } from "./ollama";
import type { AIProvider } from "./types";

export type ProviderName = "mock" | "anthropic" | "ollama";

export function configuredProviderName(): ProviderName {
  const v = (process.env.AI_PROVIDER ?? "mock").toLowerCase();
  return v === "anthropic" || v === "ollama" ? v : "mock";
}

/** Chosen by environment only. Anthropic is used only when explicitly enabled and a key is present. */
export function createProvider(mockCtx: () => MockContext, name: ProviderName = configuredProviderName()): AIProvider {
  if (name === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new Error("AI_PROVIDER=anthropic, mas ANTHROPIC_API_KEY não está configurada.");
    return new AnthropicProvider();
  }
  if (name === "ollama") return new OllamaProvider();
  return new MockProvider(mockCtx);
}

export function providerIsExternal(name: ProviderName = configuredProviderName()): boolean {
  if (name === "anthropic") return true;
  if (name === "ollama") return new OllamaProvider().isExternal;
  return false;
}
