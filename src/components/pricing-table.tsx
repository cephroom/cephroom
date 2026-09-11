"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import type { Plan } from "@/lib/entitlements";
import {
  annualSavingMonths,
  formatPrice,
  monthlyEquivalent,
  PLANS,
  PLAN_ORDER,
  type BillingInterval,
} from "@/lib/stripe/plans";

const RANK: Record<Plan, number> = { free: 0, member: 1, lab: 2 };

export function PricingTable({
  currentPlan,
  signedIn,
  checkoutAction,
  from,
}: {
  currentPlan: Plan;
  signedIn: boolean;
  checkoutAction: (formData: FormData) => Promise<void>;
  from: string;
}) {
  const [interval, setInterval] = useState<BillingInterval>("month");

  return (
    <>
      <div className="mt-8 inline-flex rounded-lg border border-rule bg-paper-raised p-1">
        {(["month", "year"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setInterval(option)}
            aria-pressed={interval === option}
            className={`rounded-md px-4 py-1.5 text-[0.85rem] font-medium transition-colors ${
              interval === option
                ? "bg-accent text-white"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {option === "month" ? "Monthly" : "Yearly"}
          </button>
        ))}
      </div>

      <div className="mt-7 grid gap-5 sm:grid-cols-3">
        <article className="flex flex-col rounded-xl border border-rule bg-paper-raised p-6">
          <h2 className="font-serif text-[1.25rem] font-semibold">Reader</h2>
          <p className="mt-1 text-[0.86rem] text-ink-muted">
            Everything that is open, in full.
          </p>
          <p className="mt-5 font-mono text-[2rem] leading-none tnum">$0</p>
          <p className="mt-1.5 text-[0.78rem] text-ink-faint">free, no card</p>

          <ul className="mt-5 flex-1 space-y-2 text-[0.86rem] text-ink-muted">
            <Perk>Open columns in full</Perk>
            <Perk>Every claim value and build badge</Perk>
            <Perk>Opening section of member columns</Perk>
          </ul>

          <div className="mt-6">
            {currentPlan === "free" ? (
              <span className="block rounded-md border border-rule px-4 py-2.5 text-center text-[0.86rem] text-ink-faint">
                {signedIn ? "Your current plan" : "No account needed"}
              </span>
            ) : (
              <span className="block px-4 py-2.5 text-center text-[0.86rem] text-ink-faint">
                Included in your plan
              </span>
            )}
          </div>
        </article>

        {PLAN_ORDER.map((planId) => {
          const plan = PLANS[planId];
          const price = plan.prices[interval];
          const isCurrent = currentPlan === planId;
          const isDowngrade = RANK[currentPlan] > RANK[planId];
          const featured = planId === "member";

          return (
            <article
              key={planId}
              className={`relative flex flex-col rounded-xl border bg-paper-raised p-6 ${
                featured ? "border-accent" : "border-rule"
              }`}
            >
              {featured && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-accent px-2.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.06em] text-white">
                  Most read
                </span>
              )}

              <h2 className="font-serif text-[1.25rem] font-semibold">
                {plan.name}
              </h2>
              <p className="mt-1 text-[0.86rem] text-ink-muted">
                {plan.tagline}
              </p>

              <p className="mt-5 font-mono text-[2rem] leading-none tnum">
                {formatPrice(price.unitAmount)}
                <span className="ml-1 font-sans text-[0.85rem] font-normal text-ink-faint">
                  /{interval === "month" ? "mo" : "yr"}
                </span>
              </p>
              <p className="mt-1.5 text-[0.78rem] text-ink-faint">
                {interval === "year"
                  ? `${monthlyEquivalent(plan)}/mo · ${annualSavingMonths(plan)} months free`
                  : "billed monthly, cancel any time"}
              </p>

              <ul className="mt-5 flex-1 space-y-2 text-[0.86rem] text-ink-muted">
                {plan.features.map((feature) => (
                  <Perk key={feature}>{feature}</Perk>
                ))}
              </ul>

              <div className="mt-6">
                {isCurrent ? (
                  <Link
                    href="/account"
                    className="block rounded-md border border-rule-strong px-4 py-2.5 text-center text-[0.88rem] font-medium transition-colors hover:border-ink-faint"
                  >
                    Manage your plan
                  </Link>
                ) : isDowngrade ? (
                  <Link
                    href="/account"
                    className="block rounded-md border border-rule px-4 py-2.5 text-center text-[0.88rem] text-ink-muted transition-colors hover:border-rule-strong"
                  >
                    Change plan in account
                  </Link>
                ) : (
                  <form action={checkoutAction}>
                    <input type="hidden" name="plan" value={planId} />
                    <input type="hidden" name="interval" value={interval} />
                    <input type="hidden" name="from" value={from} />
                    <CheckoutButton
                      label={
                        currentPlan === "free"
                          ? `Subscribe to ${plan.name}`
                          : `Upgrade to ${plan.name}`
                      }
                      featured={featured}
                    />
                  </form>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function CheckoutButton({
  label,
  featured,
}: {
  label: string;
  featured: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`w-full rounded-md px-4 py-2.5 text-[0.88rem] font-medium transition-colors disabled:opacity-60 ${
        featured
          ? "bg-accent text-white hover:bg-accent-hover"
          : "border border-rule-strong text-ink hover:border-ink-faint"
      }`}
    >
      {pending ? "Opening checkout…" : label}
    </button>
  );
}

function Perk({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <svg
        viewBox="0 0 16 16"
        className="mt-[3px] h-3.5 w-3.5 shrink-0 text-accent"
        aria-hidden
      >
        <path
          d="M3 8.4l3.2 3.2L13 4.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span>{children}</span>
    </li>
  );
}
