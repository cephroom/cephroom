import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SimulatedBillingControls } from "@/components/simulated-billing-controls";
import { ServeKey } from "@/components/serve-key";
import { SubmitButton } from "@/components/submit-button";
import { CliKey } from "@/components/cli-key";
import { TokenWallet } from "@/components/token-wallet";
import { governingSubscription, TIER_LABEL } from "@/lib/access";
import { getViewer } from "@/lib/auth/session";
import {
  cancelSubscription,
  openBillingPortal,
  resumeSubscription,
} from "@/lib/stripe/actions";
import { gateway, usingRealStripe } from "@/lib/stripe/gateway";
import { formatPrice, PLANS, priceForId } from "@/lib/stripe/plans";
import type { SubscriptionView } from "@/lib/stripe/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your key" };

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
    detail: "The retries were exhausted. Updating your payment method restores access.",
  },
  canceled: { label: "Cancelled", tone: "bad", detail: "This subscription has ended." },
  incomplete: {
    label: "Incomplete",
    tone: "warn",
    detail: "Checkout started but the first payment has not settled.",
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
  searchParams: Promise<{ checkout?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getViewer();
  if (!viewer.sub) redirect("/signin?next=/account");

  // The key arrives already re-stamped: checkout redirects through
  // /api/auth/restamp, because a page cannot set a cookie while rendering.
  const fresh = viewer;

  let subscriptions: SubscriptionView[] = [];
  if (fresh.cus) {
    try {
      subscriptions = await (await gateway()).listSubscriptions(fresh.cus);
    } catch {
      subscriptions = [];
    }
  }

  const governing = governingSubscription(subscriptions, fresh.tier);
  const status = governing ? STATUS_COPY[governing.status] : null;
  // By price id. Rebuilding from plan + interval reports the list price
  // rather than the one they are on, so a reduced-rate subscriber was told
  // they pay $9 a month.
  const price = governing
    ? (priceForId(governing.priceId)?.price ??
      PLANS[governing.tier].prices[governing.interval])
    : null;

  return (
    <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <h1 className="font-serif text-[2rem] font-semibold tracking-[-0.025em]">
        Your key
      </h1>
      <p className="mt-2 text-[0.95rem] text-ink-muted">
        {fresh.name ?? "Reader"}
      </p>

      {/* --------------------------------------------------- What you hold */}
      <section className="mt-8 rounded-xl border border-rule bg-paper-raised p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-ink-faint">
              Current tier
            </p>
            <h2 className="mt-1.5 font-serif text-[1.5rem] font-semibold">
              {TIER_LABEL[fresh.tier]}
            </h2>
            {price && fresh.tier !== "reader" && (
              <p className="mt-1 text-[0.88rem] text-ink-muted">
                {formatPrice(price.unitAmount)} per {governing!.interval}
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

        <dl className="mt-5 grid gap-x-8 gap-y-3 border-t border-rule pt-5 text-[0.85rem] sm:grid-cols-2">
          <Row label="Subject" value={fresh.sub!} mono />
          <Row
            label="Key expires in"
            value={`${Math.max(0, Math.round(fresh.expiresIn / 60))} min`}
          />
          {governing?.currentPeriodEnd && (
            <Row
              label={governing.cancelAtPeriodEnd ? "Access ends" : "Renews on"}
              value={new Date(
                governing.currentPeriodEnd * 1000,
              ).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            />
          )}
          {fresh.cus && <Row label="Stripe customer" value={fresh.cus} mono />}
        </dl>

        <div className="mt-6 flex flex-wrap gap-3">
          {fresh.tier === "reader" || !governing ? (
            <Link
              href="/pricing"
              className="rounded-md bg-accent px-5 py-2.5 text-[0.88rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
            >
              Choose a plan
            </Link>
          ) : (
            <>
              <form action={openBillingPortal}>
                <SubmitButton
                  label="Update payment method"
                  pendingLabel="Opening…"
                  variant="outline"
                />
              </form>
              <form
                action={
                  governing.cancelAtPeriodEnd
                    ? resumeSubscription
                    : cancelSubscription
                }
              >
                <input
                  type="hidden"
                  name="subscriptionId"
                  value={governing.id}
                />
                <SubmitButton
                  label={
                    governing.cancelAtPeriodEnd
                      ? "Resume subscription"
                      : "Cancel subscription"
                  }
                  pendingLabel="Working…"
                  variant={governing.cancelAtPeriodEnd ? "primary" : "quiet"}
                />
              </form>
            </>
          )}
        </div>

        {governing?.cancelAtPeriodEnd && fresh.tier !== "reader" && (
          <p className="mt-4 rounded-lg border border-drifted/30 bg-drifted-wash px-3.5 py-2.5 text-[0.84rem] leading-relaxed text-drifted">
            Cancellation scheduled. You keep full access until the end of the
            period you have already paid for. Nothing else will be charged.
          </p>
        )}
      </section>

      {/* ------------------------------------------ What we know about you */}
      <section className="mt-8 rounded-xl border border-rule p-5">
        <h2 className="text-[0.95rem] font-semibold">
          What Cephroom knows about you
        </h2>
        <p className="mt-2 max-w-[60ch] text-[0.87rem] leading-relaxed text-ink-muted">
          Nothing. There is no account row, no profile, no session record and
          no copy of your subscription. Everything above was either read out of
          the signed key in your browser or asked of Stripe a moment ago.
        </p>
        <ul className="mt-3 space-y-1.5 text-[0.85rem] text-ink-muted">
          <li>
            <span className="text-ink-faint">Your subject</span> is an HMAC of
            your provider account id. It cannot be turned back into an email.
          </li>
          <li>
            <span className="text-ink-faint">Your email and card</span> are held
            by Stripe, which has to hold them. We never copy them back.
          </li>
          <li>
            <span className="text-ink-faint">Signing out</span> clears the key
            from your browser. It does not revoke it — a copy taken beforehand
            stays valid until it expires.
          </li>
        </ul>
        <Link
          href="/how-it-works#contracts"
          className="mt-3 inline-block text-[0.85rem] font-medium text-accent hover:underline"
        >
          The constraints this follows from →
        </Link>
      </section>

      {/* -------------------------------------------- Anonymous reading */}
      <section className="mt-8 rounded-xl border border-rule p-5">
        <h2 className="text-[0.95rem] font-semibold">Read without us knowing</h2>
        <p className="mt-2 max-w-[62ch] text-[0.88rem] leading-relaxed text-ink-muted">
          Your key carries a subject, so every column you open is a request we
          could in principle associate with your subscription. We do not, and
          tests say we do not — but a promise is weaker than an impossibility.
          These tokens make it one: we blind-sign them without seeing them, and
          when your browser spends one we cannot tell whose it was.
        </p>
        <div className="mt-4">
          <TokenWallet entitled={fresh.tier !== "reader"} />
        </div>
      </section>

      {/* -------------------------------------------------- Work from a script */}
      <section className="mt-8 rounded-xl border border-rule p-5">
        <h2 className="text-[0.95rem] font-semibold">Use it from a script</h2>
        <p className="mt-2 max-w-[62ch] text-[0.88rem] leading-relaxed text-ink-muted">
          Everything the site does, the API does — discovery, fetching a
          column, checking its claims with the same code this page runs, and
          serving your own work. Nothing here is browser-only, and nothing in
          the API is unavailable here.
        </p>
        <div className="mt-4">
          <CliKey />
        </div>
        <a
          href="https://github.com/cephroom/cephroom/blob/main/docs/API.md"
          className="mt-4 inline-block text-[0.85rem] font-medium text-accent hover:underline"
        >
          The API, end to end →
        </a>
      </section>

      {/* ------------------------------------------- Run a node as yourself */}
      <section className="mt-8 rounded-xl border border-rule p-5">
        <h2 className="text-[0.95rem] font-semibold">Run a node as yourself</h2>
        <p className="mt-1.5 max-w-[60ch] text-[0.87rem] leading-relaxed text-ink-muted">
          Serving is free and needs no account — but to publish under your own
          identity, so your work is namespaced to you and nobody else can
          announce as you, your node needs a key.
        </p>
        <ServeKey sub={fresh.sub!} />
        <Link
          href="/contribute"
          className="mt-3 inline-block text-[0.85rem] font-medium text-accent hover:underline"
        >
          How to run a node →
        </Link>
      </section>

      {!usingRealStripe() && governing && (
        <SimulatedBillingControls
          subscriptionId={governing.id}
          status={governing.status}
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
