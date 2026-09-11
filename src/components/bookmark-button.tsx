import { SubmitButton } from "@/components/submit-button";

export function BookmarkButton({
  columnId,
  saved,
  returnTo,
  action,
}: {
  columnId: string;
  saved: boolean;
  returnTo: string;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="columnId" value={columnId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <SubmitButton
        label={saved ? "Saved" : "Save for later"}
        pendingLabel="..."
        variant={saved ? "primary" : "outline"}
        className="text-[0.86rem]"
      />
    </form>
  );
}
