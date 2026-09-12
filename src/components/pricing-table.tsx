"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import {
  annualSavingMonths,
  formatPrice,
  monthlyEquivalent,
  type AnyPlanId,
  type BillingInterval,
  type PlanDefinition,
} from "@/lib/stripe/plans";

/**
 * One catalogue of plans, rendered.
 *
 * Generic over which catalogue, because there are two now and they must not
 * know about each other. The component is handed the plans, the current one,
 * and a rank — it has no idea whether it is selling discovery to a consumer
 * or capacity to a contributor, which is exactly the separation the pages
 * above it are trying to keep.
 */
export function PricingTable({
  plans,
  current,
  rank,
  signedIn,
  checkoutAction,
  from,
  featuredId,
  freeNote,
}: {
  plans: PlanDefinition<AnyPlanId>[];
  current: string;
  rank: Record<string, number>;
  signedIn: boolean;
  checkoutAction: (formData: FormData) => Promise<void>;
  from: string;
  featuredId?: string;
  /** What the free plan says under its button. */
  freeNote: { current: string; included: string };
}) {
  const [interval, setInterval] = useState<BillingInterval>("month");
  const free = plans.find((plan) => !plan.prices);
  const paid = plans.filter((plan) => plan.prices);

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
                ? "bg-accent text-accent-ink"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {option === "month" ? "Monthly" : "Yearly"}
          </button>
        ))}
      </div>

      <div className="mt-7 grid gap-5 sm:grid-cols-3">
        <article className="flex flex-col rounded-xl border border-rule bg-paper-raised p-6">
          <h2 className="font-serif text-[1.25rem] font-semibold">{free?.name}</h2>
          <p className="mt-1 text-[0.86rem] text-ink-muted">{free?.tagline}</p>
          <p className="mt-5 font-mono text-[2rem] leading-none tnum">$0</p>
          <p className="mt-1.5 text-[0.78rem] text-ink-faint">free, no card</p>

          <ul className="mt-5 flex-1 space-y-2 text-[0.86rem] text-ink-muted">
            {free?.features.map((feature) => (
              <Perk key={feature}>{feature}</Perk>
            ))}
          </ul>

          <div className="mt-6">
            {free && current === free.id ? (
              <span className="block rounded-md border border-rule px-4 py-2.5 text-center text-[0.86rem] text-ink-faint">
                {signedIn ? freeNote.current : "No account needed"}
              </span>
            ) : (
              <span className="block px-4 py-2.5 text-center text-[0.86rem] text-ink-faint">
                {freeNote.included}
              </span>
            )}
          </div>
        </article>

        {paid.map((plan) => {
          const planId = plan.id;
          const price = plan.prices![interval];
          const isCurrent = current === planId;
          const isDowngrade = (rank[current] ?? 0) > (rank[planId] ?? 0);
          const featured = planId === featuredId;

          return (
            <article
              key={planId}
              className={`relative flex flex-col rounded-xl border bg-paper-raised p-6 ${
                featured ? "border-accent" : "border-rule"
              }`}
            >
              {featured && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-accent px-2.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.06em] text-accent-ink">
                  Most chosen
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
                    className="block rounded-md border border-field-border px-4 py-2.5 text-center text-[0.88rem] font-medium transition-colors hover:border-ink-faint"
                  >
                    Manage your plan
                  </Link>
                ) : isDowngrade ? (
                  <Link
                    href="/account"
                    className="block rounded-md border border-rule px-4 py-2.5 text-center text-[0.88rem] text-ink-muted transition-colors hover:border-field-border"
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
                        (rank[current] ?? 0) === 0
                          ? `Subscribe to ${plan.name}`
                          : `Change to ${plan.name}`
                      }
                      featured={featured}
                    />
                  </form>
                )}
              </div>

              {}
              {plan.reduced && !isCurrent && !isDowngrade && (
                <div className="mt-5 border-t border-rule pt-4">
                  <form action={checkoutAction}>
                    <input type="hidden" name="plan" value={planId} />
                    <input type="hidden" name="interval" value="year" />
                    <input type="hidden" name="reduced" value="1" />
                    <input type="hidden" name="from" value={from} />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[0.8rem] font-medium text-counter">
                        {plan.reduced.label}
                      </span>
                      <span className="font-mono text-[0.95rem] tnum text-ink">
                        {formatPrice(plan.reduced.unitAmount)}
                        <span className="ml-0.5 font-sans text-[0.72rem] font-normal text-ink-faint">
                          /yr
                        </span>
                      </span>
                    </div>
                    <p className="mt-1.5 text-[0.76rem] leading-relaxed text-ink-faint">
                      {plan.reduced.note}
                    </p>
                    <ReducedButton />
                  </form>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

function ReducedButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-3 w-full rounded-md border border-counter/40 bg-counter-wash px-4 py-2 text-[0.83rem] font-medium text-counter transition-colors hover:border-counter disabled:opacity-60"
    >
      {pending ? "Opening checkout…" : "Take the reduced rate"}
    </button>
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
          ? "bg-accent text-accent-ink hover:bg-accent-hover"
          : "border border-field-border text-ink hover:border-ink-faint"
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
