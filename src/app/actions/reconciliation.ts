"use server";
// The person's side of card reconciliation (docs/AUTOCONCILIACAO.md): apply or dismiss proposals, undo a change,
// apply a suggestion from Conferir. Every action is scoped to the signed-in user inside the library functions.
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireWriter } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { applyAllProposals, applyChange, applySuggestion, dismissChange, dismissProjection, restoreProjections, revertChange } from "@/lib/card-reconciliation";

const id = (form: FormData, name = "id") => String(form.get(name) ?? "").slice(0, 64);

export async function applyChangeAction(form: FormData): Promise<void> {
  const user = await requireWriter();
  const db = await getDb();
  if (await applyChange(db, user.id, id(form))) await audit(db, user.id, "reconciliation.applied", { changeId: id(form) });
  revalidatePath("/", "layout");
}

/** Only after the confirmation dialog, and only for the count it showed (see applyAllProposals). */
export async function applyAllAction(form: FormData): Promise<void> {
  const user = await requireWriter();
  const db = await getDb();
  const expected = Number(form.get("count"));
  if (!Number.isInteger(expected) || expected <= 0) return;
  const n = await applyAllProposals(db, user.id, { expected });
  if (n) await audit(db, user.id, "reconciliation.applied_all", { count: n });
  revalidatePath("/", "layout");
}

export async function dismissChangeAction(form: FormData): Promise<void> {
  const user = await requireWriter();
  const db = await getDb();
  if (await dismissChange(db, user.id, id(form))) await audit(db, user.id, "reconciliation.dismissed", { changeId: id(form) });
  revalidatePath("/", "layout");
}

export async function revertChangeAction(form: FormData): Promise<void> {
  const user = await requireWriter();
  const db = await getDb();
  if (await revertChange(db, user.id, id(form))) await audit(db, user.id, "reconciliation.reverted", { changeId: id(form) });
  revalidatePath("/", "layout");
}

export async function applySuggestionAction(form: FormData): Promise<void> {
  const user = await requireWriter();
  const change = String(form.get("change") ?? "");
  if (change !== "to-payment" && change !== "to-refund") return;
  const db = await getDb();
  if (await applySuggestion(db, user.id, id(form, "tx"), change)) await audit(db, user.id, "reconciliation.suggestion_applied", { transactionId: id(form, "tx") });
  revalidatePath("/", "layout");
}

/** Excludes one "parcela prevista" from this card's bills; it is never projected again (see dismissProjection). */
export async function dismissProjectionAction(form: FormData): Promise<void> {
  const user = await requireWriter();
  const db = await getDb();
  const account = id(form, "account");
  const key = String(form.get("key") ?? "").slice(0, 80);
  if (await dismissProjection(db, user.id, account, key)) await audit(db, user.id, "reconciliation.projection_dismissed", { accountId: account, key });
  revalidatePath("/", "layout");
}

/** Brings back every prevista the person excluded on this card. */
export async function restoreProjectionsAction(form: FormData): Promise<void> {
  const user = await requireWriter();
  const db = await getDb();
  const account = id(form, "account");
  if (await restoreProjections(db, user.id, account)) await audit(db, user.id, "reconciliation.projections_restored", { accountId: account });
  revalidatePath("/", "layout");
}
