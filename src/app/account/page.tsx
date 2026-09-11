import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SubmitButton } from "@/components/submit-button";
import { formatDate } from "@/lib/columns";
import { getViewer, PLAN_LABEL } from "@/lib/entitlements";
import {
  cancelSubscription,
  openBillingPortal,
  resumeSubscription,
  resyncSubscription,
} from "@/lib/stripe/actions";
import { gateway, usingRealStripe } from "@/lib/stripe/gateway";
import { formatPrice, PLANS } from "@/lib/stripe/plans";
import type { InvoiceSummary } from "@/lib/stripe/types";
import { LocalBillingControls } from "@/components/local-billing-controls";

export const metadata: Metadata = { title: "Account" };

const STATUS_COPY: Record<
  string,
  { label: string; tone: "ok" | "warn" | "bad"; detail: string }
> = {
  active: { label: "Active", tone: "ok", detail: "Paid and current." },
  trialing: { label: "Trialing", tone: "ok", detail: "Your trial is running." },
  past_due: {
    label: "Payment failed",
    tone: "warn",
    detail:
      "The last charge did not go through. Stripe is retrying over the next few days and you keep full access meanwhile — but update your card before the retries run out.",
  },
  unpaid: {
    label: "Unpaid",
    tone: "bad",
    detail:
      "The retries were exhausted. Access has ended; updating your payment method will restore it.",
  },
  canceled: {
    label: "Cancelled",
    tone: "bad",
    detail: "This subscription has ended.",
  },
  incomplete: {
    label: "Incomplete",
    tone: "warn",
    detail: "Checkout started but the first payment has not settled.",
  },
  incomplete_expired: {
    label: "Expired",
    tone: "bad",
    detail: "The first payment never settled and the subscription expired.",
  },
  paused: {
    label: "Paused",
    tone: "warn",
    detail: "Collection is paused. Access is suspended until it resumes.",
  },
};

const TONE_CLASS = {
  ok: "border-verified/30 bg-verified-wash text-verified",
  warn: "border-drifted/30 bg-drifted-wash text-drifted",
  bad: "border-broken/30 bg-broken-wash text-broken",
} as const;

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; outcome?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getViewer();
  if (!viewer.id) redirect("/signin?callbackUrl=/account");

  const subscription = viewer.subscription;
  const status = subscription ? STATUS_COPY[subscription.status] : null;

  let invoices: InvoiceSummary[] = [];
  if (subscription) {
    try {
      invoices = await gateway().listInvoices(subscription.stripeCustomerId);
    } catch (error) {
      console.error("[stripe] invoice listing failed", error);
    }
  }

  // The subscription row outlives the entitlement it granted, so the price
  // and the renewal notice are tied to the *current* plan rather than to the
  // row - otherwise a cancelled account still advertises "$9 per month".
  const entitled = viewer.plan !== "free";
  const price =
    subscription && entitled
      ? PLANS[subscription.plan].prices[subscription.interval]
      : null;
  const ended = subscription?.status === "canceled" || subscription?.status === "incomplete_expired";

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <h1 className="font-serif text-[2rem] font-semibold tracking-[-0.025em]">
        Account
      </h1>
      <p className="mt-2 text-[0.95rem] text-ink-muted">
        {viewer.name} · {viewer.email}
      </p>

      {params.checkout === "success" && subscription?.status === "active" && (
        <p
          role="status"
          className="mt-6 rounded-lg border border-verified/30 bg-verified-wash px-4 py-3 text-[0.88rem] text-verified"
        >
          Subscription active. Everything is unlocked.
        </p>
      )}
      {/* The query param survives a refresh; the banner should not outlive
          the condition it describes. */}
      {params.outcome === "declined" && subscription?.status !== "active" && (
        <p
          role="status"
          className="mt-6 rounded-lg border border-broken/30 bg-broken-wash px-4 py-3 text-[0.88rem] text-broken"
        >
          That card was declined. The subscription exists but is unpaid —
          update the payment method to activate it.
        </p>
      )}

      {/* ------------------------------------------------------ Plan card */}
      <section className="mt-8 rounded-xl border border-rule bg-paper-raised p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
              Current plan
            </p>
            <h2 className="mt-1.5 font-serif text-[1.5rem] font-semibold">
              {PLAN_LABEL[viewer.plan]}
            </h2>
            {price && (
              <p className="mt-1 text-[0.88rem] text-ink-muted">
                {formatPrice(price.unitAmount)} per {subscription!.interval}
              </p>
            )}
          </div>

          {status && (
            <span
              className={`rounded-full border px-2.5 py-1 text-[0.75rem] font-medium ${TONE_CLASS[status.tone]}`}
            >
              {status.label}
            </span>
          )}
        </div>

        {status && (
          <p className="mt-4 max-w-[60ch] text-[0.88rem] leading-relaxed text-ink-muted">
            {status.detail}
          </p>
        )}

        {subscription && (
          <dl className="mt-5 grid gap-x-8 gap-y-3 border-t border-rule pt-5 text-[0.85rem] sm:grid-cols-2">
            <Row
              label={
                ended
                  ? "Ended"
                  : subscription.cancelAtPeriodEnd
                    ? "Access ends"
                    : "Renews on"
              }
              value={formatDate(
                ended
                  ? (subscription.canceledAt ?? subscription.currentPeriodEnd)
                  : subscription.currentPeriodEnd,
              )}
            />
            <Row label="Started" value={formatDate(subscription.createdAt)} />
            <Row
              label="Subscription"
              value={subscription.stripeSubscriptionId}
              mono
            />
            <Row label="Customer" value={subscription.stripeCustomerId} mono />
          </dl>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {!subscription || viewer.plan === "free" ? (
            <Link
              href="/pricing"
              className="rounded-md bg-accent px-5 py-2.5 text-[0.88rem] font-medium text-white transition-colors hover:bg-accent-hover"
            >
              {subscription ? "Restart a subscription" : "Choose a plan"}
            </Link>
          ) : (
            <>
              <form action={openBillingPortal}>
                <SubmitButton
                  label="Update payment method"
                  pendingLabel="Opening portal…"
                  variant="outline"
                />
              </form>

              {subscription.cancelAtPeriodEnd ? (
                <form action={resumeSubscription}>
                  <SubmitButton
                    label="Resume subscription"
                    pendingLabel="Resuming…"
                    variant="primary"
                  />
                </form>
              ) : (
                <form action={cancelSubscription}>
                  <SubmitButton
                    label="Cancel subscription"
                    pendingLabel="Cancelling…"
                    variant="quiet"
                  />
                </form>
              )}

              {viewer.plan === "member" && (
                <Link
                  href="/pricing"
                  className="rounded-md border border-rule-strong px-4 py-2.5 text-[0.88rem] font-medium transition-colors hover:border-ink-faint"
                >
                  Upgrade to Lab
                </Link>
              )}
            </>
          )}
        </div>

        {subscription?.cancelAtPeriodEnd && entitled && (
          <p className="mt-4 rounded-lg border border-drifted/30 bg-drifted-wash px-3.5 py-2.5 text-[0.84rem] leading-relaxed text-drifted">
            Cancellation scheduled. You keep full access until{" "}
            {formatDate(subscription.currentPeriodEnd)} — the period you have
            already paid for. Nothing else will be charged.
          </p>
        )}
      </section>

      {/* --------------------------------------------------------- Invoices */}
      {invoices.length > 0 && (
        <section className="mt-8">
          <h2 className="font-serif text-[1.25rem] font-semibold">Invoices</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-rule">
            <table className="w-full text-[0.85rem]">
              <thead>
                <tr className="border-b border-rule bg-paper-sunken text-left">
                  <Th>Invoice</Th>
                  <Th>Date</Th>
                  <Th>Amount</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-rule last:border-0">
                    <Td mono>{invoice.number ?? invoice.id}</Td>
                    <Td>{formatDate(new Date(invoice.created * 1000))}</Td>
                    <Td mono>
                      {formatPrice(
                        invoice.status === "paid"
                          ? invoice.amountPaid
                          : invoice.amountDue,
                      )}
                    </Td>
                    <Td>
                      <span
                        className={
                          invoice.status === "paid"
                            ? "text-verified"
                            : "text-drifted"
                        }
                      >
                        {invoice.status}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------- Repair */}
      <section className="mt-8 rounded-xl border border-rule p-5">
        <h2 className="text-[0.95rem] font-semibold">Out of sync?</h2>
        <p className="mt-1.5 max-w-[58ch] text-[0.85rem] leading-relaxed text-ink-muted">
          Stripe is the source of truth and this page reads a local copy kept
          current by webhooks. If a webhook was missed, re-reading Stripe
          directly will repair it.
        </p>
        <form action={resyncSubscription} className="mt-4">
          <SubmitButton
            label="Re-read from Stripe"
            pendingLabel="Reading…"
            variant="outline"
          />
        </form>
      </section>

      {!usingRealStripe() && subscription && (
        <LocalBillingControls
          subscriptionId={subscription.stripeSubscriptionId}
          status={subscription.status}
        />
      )}
    </main>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-ink-faint">{label}</dt>
      <dd className={`mt-0.5 ${mono ? "truncate font-mono text-[0.76rem]" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.06em] text-ink-faint">
      {children}
    </th>
  );
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td className={`px-4 py-2.5 ${mono ? "font-mono text-[0.78rem] tnum" : ""}`}>
      {children}
    </td>
  );
}
