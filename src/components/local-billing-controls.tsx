import { SubmitButton } from "@/components/submit-button";
import {
  endPeriodAction,
  exhaustDunningAction,
  recoverPaymentAction,
} from "@/lib/stripe/local-actions";

/**
 * Drives the events Stripe would normally send on its own schedule — a
 * successful retry, an exhausted dunning cycle, a period rollover — so the
 * whole subscription lifecycle can be walked through without waiting days
 * for real billing cycles. Only rendered when no Stripe key is configured.
 */
export function LocalBillingControls({
  subscriptionId,
  status,
}: {
  subscriptionId: string;
  status: string;
}) {
  return (
    <section className="mt-8 rounded-xl border border-drifted/30 bg-drifted-wash/40 p-5">
      <h2 className="text-[0.95rem] font-semibold text-drifted">
        Local billing controls
      </h2>
      <p className="mt-1.5 max-w-[58ch] text-[0.83rem] leading-relaxed text-ink-muted">
        No Stripe key is configured. These buttons make the local stand-in send
        the webhook events Stripe would send over the following days, so the
        dunning and renewal paths can be exercised now rather than in a week.
      </p>

      <div className="mt-4 flex flex-wrap gap-2.5">
        {status === "past_due" && (
          <form action={recoverPaymentAction}>
            <input type="hidden" name="subscriptionId" value={subscriptionId} />
            <SubmitButton
              label="Retry succeeds → active"
              pendingLabel="Delivering…"
              variant="outline"
            />
          </form>
        )}

        {(status === "past_due" || status === "unpaid") && (
          <form action={exhaustDunningAction}>
            <input type="hidden" name="subscriptionId" value={subscriptionId} />
            <SubmitButton
              label="Retries exhausted → cancelled"
              pendingLabel="Delivering…"
              variant="danger"
            />
          </form>
        )}

        <form action={endPeriodAction}>
          <input type="hidden" name="subscriptionId" value={subscriptionId} />
          <SubmitButton
            label="Advance one billing period"
            pendingLabel="Delivering…"
            variant="outline"
          />
        </form>
      </div>
    </section>
  );
}
