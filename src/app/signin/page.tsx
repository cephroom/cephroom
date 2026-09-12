import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth/session";
import { isConfigured, providers, safeNext } from "@/lib/auth/providers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  unconfigured: "That provider is not configured on this deployment.",
  state: "The sign-in request did not match. Start again.",
  expired: "That sign-in attempt timed out. Start again.",
  denied: "The provider declined the sign-in.",
  exchange: "The provider would not complete the exchange.",
  unknown: "Unknown provider.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const viewer = await getViewer();
  const next = safeNext(params.next);

  if (viewer.sub) redirect(next);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-6xl items-center justify-center px-5 py-14">
      <div className="w-full max-w-[25rem]">
        <h1 className="font-serif text-[1.75rem] font-semibold tracking-[-0.02em]">
          Get a key
        </h1>
        <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-muted">
          Signing in proves who you are and nothing is written down. You get a
          signed key that says what you may read; Cephroom keeps no account for
          you, because it keeps no accounts at all.
        </p>

        {params.error && (
          <p
            role="alert"
            className="mt-5 rounded-md border border-broken/30 bg-broken-wash px-3 py-2 text-[0.82rem] text-broken"
          >
            {ERRORS[params.error] ?? "Sign-in did not complete. Try again."}
          </p>
        )}

        <div className="mt-7 space-y-2.5">
          {providers().map((provider) =>
            isConfigured(provider) ? (
              <a
                key={provider.id}
                href={`/api/auth/start?provider=${provider.id}&next=${encodeURIComponent(next)}`}
                className="flex w-full items-center justify-center gap-2.5 rounded-md border border-field-border bg-paper-raised px-4 py-2.5 text-[0.88rem] font-medium text-ink transition-colors hover:border-ink-faint"
              >
                {provider.label}
              </a>
            ) : (
              <span
                key={provider.id}
                title={`Set AUTH_${provider.id.toUpperCase()}_ID and AUTH_${provider.id.toUpperCase()}_SECRET to enable this.`}
                className="flex w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-md border border-rule bg-paper-sunken px-4 py-2.5 text-[0.88rem] font-medium text-ink-faint"
              >
                {provider.label}
                <span className="text-[0.72rem] font-normal">not configured</span>
              </span>
            ),
          )}
        </div>

        <div className="mt-7 rounded-lg border border-rule bg-paper-sunken p-4">
          <h2 className="text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            What this does not do
          </h2>
          <ul className="mt-2.5 space-y-1.5 text-[0.83rem] leading-relaxed text-ink-muted">
            <li>No account is created. There is no user table to put one in.</li>
            <li>No email address is stored, here or anywhere we control.</li>
            <li>
              No session is recorded. Your key is checked by its signature, not
              by looking you up.
            </li>
            <li>
              There is no password, because a password would mean storing
              something about you.
            </li>
          </ul>
          <Link
            href="/how-it-works#contracts"
            className="mt-3 inline-block text-[0.82rem] font-medium text-accent hover:underline"
          >
            Why it is built this way →
          </Link>
        </div>
      </div>
    </main>
  );
}
