import { Field, Input } from "@/components/ui";

/** Second factor for actions a stolen session plus a phished password must not reach. */
export function StepUpCode({ id, show = true }: { id: string; show?: boolean }) {
  if (!show) return null;
  return (
    <Field label="Código de 6 dígitos do autenticador" htmlFor={id}>
      <Input id={id} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
    </Field>
  );
}
