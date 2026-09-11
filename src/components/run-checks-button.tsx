import { SubmitButton } from "@/components/submit-button";

export function RunChecksButton({
  action,
  columnId,
}: {
  action: (formData: FormData) => Promise<void>;
  columnId: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="columnId" value={columnId} />
      <SubmitButton
        label="Re-run checks"
        pendingLabel="Running…"
        variant="outline"
      />
    </form>
  );
}
