import Link from "next/link";

import { Wordmark } from "@/components/brand";
import { KeyMenu } from "@/components/key-menu";
import { MobileNav } from "@/components/mobile-nav";
import { SessionResume } from "@/components/session-resume";
import { TIER_LABEL } from "@/lib/access";
import { canResumeSession, getViewer } from "@/lib/auth/session";

const NAV = [
  { href: "/read", label: "Reading now" },
  { href: "/contribute", label: "Contribute" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Plans" },
];

export async function SiteHeader() {
  // Reading a cookie and verifying a signature. No lookup, because there is
  // nothing to look anything up in.
  const viewer = await getViewer();
  // A returning member whose 15-minute access key lapsed but whose 7-day
  // refresh key is still good would otherwise appear signed out on a cold
  // load. This resumes them silently.
  const resumable = !viewer.sub && (await canResumeSession());

  return (
    <>
    {resumable && <SessionResume />}
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
        <Wordmark />

        <nav className="hidden items-center gap-6 md:flex" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[0.855rem] text-ink-muted transition-colors hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {viewer.sub ? (
            <KeyMenu
              subject={viewer.sub}
              tier={viewer.tier}
              tierLabel={TIER_LABEL[viewer.tier]}
              expiresIn={viewer.expiresIn}
            />
          ) : (
            <>
              <Link
                href="/signin"
                className="hidden rounded-md px-3 py-1.5 text-[0.855rem] text-ink-muted transition-colors hover:text-ink sm:block"
              >
                Sign in
              </Link>
              <Link
                href="/pricing"
                className="rounded-md bg-accent px-3.5 py-1.5 text-[0.855rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
              >
                Subscribe
              </Link>
            </>
          )}
          <MobileNav items={NAV} signedIn={Boolean(viewer.sub)} />
        </div>
      </div>
    </header>
    </>
  );
}
