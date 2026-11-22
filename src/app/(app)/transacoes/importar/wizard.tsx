"use client";
import Link from "next/link";
import { useId, useState } from "react";
import type { Preview } from "@/lib/importer";
import { formatBRL } from "@/lib/money";
import { formatDateBR } from "@/lib/dates";
import { plural } from "@/lib/text";
import { Sensitive } from "@/components/client";
import { Badge, Button, Card, CardTitle, Field, FormError, Notice, Select } from "@/components/ui";

type Mapping = { date?: string; description?: string; amount?: string; debit?: string; credit?: string; invertSign?: boolean };

const STATUS: Record<string, { label: string; tone: "positive" | "neutral" | "risk" }> = {
  new: { label: "Nova", tone: "positive" },
  duplicate: { label: "Já importada", tone: "neutral" },
  invalid: { label: "Inválida", tone: "risk" },
};

/** Brazilian banks still export Latin-1: valid UTF-8 is used as is, anything else falls back to Windows-1252. */
function decodeStatement(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function ImportWizard({ accounts }: { accounts: { id: string; name: string; type: string }[] }) {
  const ids = useId();
  const [accountId, setAccountId] = useState(accounts[0]!.id);
  const [file, setFile] = useState<{ name: string; content: string; format: "csv" | "ofx" } | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ imported: number; skipped: number; invalid: number } | null>(null);

  async function readFile(f: File) {
    setError(undefined);
    setDone(null);
    setPreview(null);
    if (f.size > 2 * 1024 * 1024) return setError("Arquivo maior que 2 MB.");
    const format = /\.ofx$/i.test(f.name) ? "ofx" : /\.(csv|txt)$/i.test(f.name) ? "csv" : null;
    if (!format) return setError("Use um arquivo .csv ou .ofx.");
    const content = decodeStatement(await f.arrayBuffer());
    setFile({ name: f.name, content, format });
    setMapping({});
    await requestPreview({ name: f.name, content, format }, undefined);
  }

  async function call(path: string, f: NonNullable<typeof file>, m?: Mapping, account = accountId) {
    const mappingPayload = m && m.date && m.description && (m.amount || m.debit || m.credit) ? m : undefined;
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: f.format, fileName: f.name, content: f.content, accountId: account, mapping: f.format === "csv" ? mappingPayload : undefined }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Erro ao processar o arquivo.");
    return body;
  }

  // What gets imported must be what was previewed: a changed mapping blocks confirming until the preview is redone.
  function editMapping(m: Mapping) {
    setMapping(m);
    setStale(true);
  }

  // Duplicates are per account, so a preview is only valid for the account it was made for.
  function changeAccount(id: string) {
    setAccountId(id);
    setPreview(null);
    void requestPreview(file, mapping, id);
  }

  async function requestPreview(f = file, m: Mapping | undefined = mapping, account = accountId) {
    if (!f) return;
    setBusy(true);
    setError(undefined);
    try {
      const p = (await call("/api/import/preview", f, m, account)) as Preview;
      setPreview(p);
      setStale(false);
      if (p.suggestedMapping && !m?.date) setMapping({ ...p.suggestedMapping });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      setDone(await call("/api/import/commit", file, mapping));
      setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const headers = preview?.headers ?? [];
  const col = (key: keyof Mapping, label: string, optional = false) => (
    <Field label={label} htmlFor={`${ids}-${key}`}>
      <Select id={`${ids}-${key}`} value={(mapping[key] as string) ?? ""} onChange={(e) => editMapping({ ...mapping, [key]: e.target.value || undefined })}>
        <option value="">{optional ? "Não usar" : "Escolha a coluna"}</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle>Arquivo</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Conta de destino" htmlFor={`${ids}-acc`}>
            <Select id={`${ids}-acc`} value={accountId} onChange={(e) => changeAccount(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Extrato (.csv ou .ofx, até 2 MB)" htmlFor={`${ids}-file`}>
            <input
              id={`${ids}-file`}
              type="file"
              accept=".csv,.ofx,.txt,text/csv"
              className="min-h-11 w-full rounded-lg border border-border bg-surface p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-primary"
              onChange={(e) => {
                const f = e.target.files?.[0];
                // Reset so choosing the same file again (e.g. to re-check duplicates) fires change.
                e.target.value = "";
                if (f) void readFile(f);
              }}
            />
          </Field>
        </div>
      </Card>

      <div aria-live="polite" className="flex flex-col gap-4">
        <FormError message={error} />
        {busy ? <div className="skeleton h-24" aria-label="Processando arquivo" /> : null}
        {done ? (
          <Notice tone="positive" title="Importação concluída">
            {plural(done.imported, "transação importada", "transações importadas")}, {plural(done.skipped, "ignorada", "ignoradas")} (já existiam ou eram inválidas). <Link href="/transacoes" className="font-medium text-primary underline">Ver transações</Link>
          </Notice>
        ) : null}
      </div>

      {file?.format === "csv" && preview ? (
        // Technical step: only asks for attention when the columns could not be recognized.
        <Card>
          <details open={preview.needsMapping || undefined}>
            <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">
              {preview.needsMapping ? "Não reconheci as colunas deste arquivo" : "Valores errados? Ajuste as colunas"}
            </summary>
            <p className="mb-3 text-sm text-muted">
              {preview.needsMapping ? "Diga onde estão a data, a descrição e o valor." : "Reconhecemos as colunas automaticamente. Só mude algo se a prévia abaixo estiver errada."}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {col("date", "Data")}
              {col("description", "Descrição")}
              {col("amount", "Valor (coluna única)", true)}
              {col("debit", "Saídas (se forem separadas)", true)}
              {col("credit", "Entradas (se forem separadas)", true)}
            </div>
            <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" className="size-5 shrink-0 accent-[var(--primary)]" checked={Boolean(mapping.invertSign)} onChange={(e) => editMapping({ ...mapping, invertSign: e.target.checked })} />
              Compras aparecem como valores positivos (comum em fatura de cartão)
            </label>
            <Button variant="secondary" className="mt-2" onClick={() => void requestPreview()} disabled={busy}>
              Atualizar prévia
            </Button>
          </details>
        </Card>
      ) : null}

      {preview && !preview.needsMapping ? (
        <Card>
          <CardTitle>Prévia e confirmação</CardTitle>
          {stale ? <div className="mb-3"><Notice tone="attention">Você mudou as colunas. Clique em Atualizar prévia antes de importar.</Notice></div> : null}
          <p className="mb-3 text-sm">
            {plural(preview.counts.total, "linha", "linhas")}: <strong>{plural(preview.counts.new, "nova", "novas")}</strong>, {plural(preview.counts.duplicate, "já importada", "já importadas")}, {plural(preview.counts.invalid, "inválida", "inválidas")}.
          </p>
          <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">Prévia das linhas do arquivo</caption>
              <thead className="sticky top-0 bg-surface-2 text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Linha</th>
                  <th scope="col" className="px-3 py-2 font-medium">Situação</th>
                  <th scope="col" className="px-3 py-2 font-medium">Data</th>
                  <th scope="col" className="px-3 py-2 font-medium">Descrição</th>
                  <th scope="col" className="px-3 py-2 font-medium">Categoria sugerida</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 200).map((r) => (
                  <tr key={r.line} className="border-t border-border">
                    <td className="px-3 py-1.5 text-muted">{r.line}</td>
                    <td className="px-3 py-1.5">
                      <Badge tone={STATUS[r.status]!.tone}>{STATUS[r.status]!.label}</Badge>
                    </td>
                    <td className="px-3 py-1.5">{r.date ? formatDateBR(r.date) : "—"}</td>
                    <td className="px-3 py-1.5">{r.description ?? <span className="text-risk">{r.error}</span>}</td>
                    <td className="px-3 py-1.5 text-muted">{r.categoryName ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.amountCents !== undefined ? <Sensitive>{formatBRL(r.amountCents)}</Sensitive> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > 200 ? <p className="mt-2 text-meta text-muted">Mostrando 200 de {preview.rows.length} linhas.</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void commit()} disabled={busy || stale || preview.counts.new === 0}>
              Importar {plural(preview.counts.new, "transação", "transações")}
            </Button>
            <Button variant="ghost" onClick={() => { setPreview(null); setFile(null); }}>
              Cancelar
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
