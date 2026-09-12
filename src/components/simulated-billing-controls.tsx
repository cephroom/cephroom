import { SubmitButton } from "@/components/submit-button";
import {
  advancePeriodAction,
  exhaustDunningAction,
  recoverPaymentAction,
} from "@/lib/stripe/simulated-actions";

export function SimulatedBillingControls({
  subscriptionId,
  status,
}: {
  subscriptionId: string;
  status: string;
}) {
  return (
    <section className="mt-8 rounded-xl border border-drifted/30 bg-drifted-wash/40 p-5">
      <h2 className="text-[0.95rem] font-semibold text-drifted">
        Simulated billing controls
      </h2>
      <p className="mt-1.5 max-w-[58ch] text-[0.83rem] leading-relaxed text-ink-muted">
        No Stripe key is configured, so a simulated counterparty is standing in
        for Stripe. Each button moves the subscription and re-stamps your key,
        which is what a real billing change would do.
      </p>

      <div className="mt-4 flex flex-wrap gap-2.5">
        {status === "past_due" && (
          <form action={recoverPaymentAction}>
            <input type="hidden" name="subscriptionId" value={subscriptionId} />
            <SubmitButton
              label="Retry succeeds → active"
              pendingLabel="Applying…"
              variant="outline"
            />
          </form>
        )}

        {(status === "past_due" || status === "unpaid") && (
          <form action={exhaustDunningAction}>
            <input type="hidden" name="subscriptionId" value={subscriptionId} />
            <SubmitButton
              label="Retries exhausted → cancelled"
              pendingLabel="Applying…"
              variant="danger"
            />
          </form>
        )}

        <form action={advancePeriodAction}>
          <input type="hidden" name="subscriptionId" value={subscriptionId} />
          <SubmitButton
            label="Advance one billing period"
            pendingLabel="Applying…"
            variant="outline"
          />
        </form>
      </div>
    </section>
  );
}
