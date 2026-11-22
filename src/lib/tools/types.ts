import type { z } from "zod";
import type { DB } from "@/db/connection";

export type ToolContext = { db: DB; userId: string; today: string };

export type SourceLink = { label: string; href: string };

/** What backs an answer: shown to the user next to every chat reply. */
export type Evidence = {
  tool: string;
  period?: { from: string; to: string; label: string; defaulted: boolean };
  filters: { accounts: string[]; categories: string[]; other?: string[] };
  sources: SourceLink[];
  notes?: string[];
};

export type ToolResult = {
  /** JSON-safe payload for the model. Untrusted strings inside are sanitized and marked as data. */
  data: unknown;
  evidence: Evidence;
  /** Deterministic pt-BR rendering of the facts; used by the mock provider and as a fallback. */
  text: string;
  /** Set when the tool needs the user to clarify (e.g. unknown category). */
  clarification?: string;
  draftAgentId?: string;
};

export type ToolDef<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: S;
  run: (ctx: ToolContext, input: z.infer<S>) => Promise<ToolResult>;
};
