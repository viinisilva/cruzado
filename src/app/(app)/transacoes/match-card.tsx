import { formatDateBR } from "@/lib/dates";
import { originLabel } from "@/lib/finance/labels";
import { formatBRL } from "@/lib/money";
import { Button, Card } from "@/components/ui";
import { Sensitive } from "@/components/client";
import { confirmMatchAction, dismissMatchAction } from "../../actions/whatsapp";

type Side = { description: string; date: string; amountCents: number; source: string; channel: string | null };

export function MatchSide({ label, tx }: { label: string; tx: Side }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 p-3 text-sm">
      <p className="text-meta text-muted">{label} · {originLabel(tx.source, tx.channel)}</p>
      <p className="break-words font-medium">{tx.description}</p>
      <p className="tabular-nums text-muted">{formatDateBR(tx.date)} · <Sensitive>{formatBRL(tx.amountCents)}</Sensitive></p>
    </div>
  );
}

const typed = (source: string) => source === "assistant" || source === "manual";

/** The two records side by side and the only two honest answers: same purchase, or two purchases. */
export function MatchCard({ match }: { match: { id: string; entry: Side; bank: Side } }) {
  return (
    <Card>
      <p className="mb-2 text-sm text-muted">Mesma conta e mesmo valor, em datas próximas. Pode ser o mesmo gasto registrado duas vezes.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <MatchSide label={typed(match.entry.source) ? "Você informou" : "Já estava aqui"} tx={match.entry} />
        <MatchSide label={match.bank.source === "open_finance" ? "Veio do banco" : "Veio do arquivo"} tx={match.bank} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <form action={confirmMatchAction}>
          <input type="hidden" name="id" value={match.id} />
          <Button type="submit">É o mesmo gasto</Button>
        </form>
        <form action={dismissMatchAction}>
          <input type="hidden" name="id" value={match.id} />
          <Button type="submit" variant="secondary">São gastos diferentes</Button>
        </form>
      </div>
    </Card>
  );
}
