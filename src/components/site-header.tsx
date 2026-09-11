import Link from "next/link";

import { AccountMenu } from "@/components/account-menu";
import { Wordmark } from "@/components/brand";
import { MobileNav } from "@/components/mobile-nav";
import { signOutAction } from "@/lib/auth/sign-out";
import { getViewer, PLAN_LABEL } from "@/lib/entitlements";

const NAV = [
  { href: "/columns", label: "Columns" },
  { href: "/datasets", label: "Datasets" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
];

export async function SiteHeader() {
  const viewer = await getViewer();
  const signedIn = Boolean(viewer.id);

  return (
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
          {signedIn ? (
            <AccountMenu
              name={viewer.name ?? viewer.email ?? "Reader"}
              email={viewer.email}
              handle={viewer.handle}
              plan={viewer.plan}
              planLabel={PLAN_LABEL[viewer.plan]}
              canWrite={viewer.role === "author" || viewer.role === "editor"}
              signOutAction={signOutAction}
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
                href="/signup"
                className="rounded-md bg-accent px-3.5 py-1.5 text-[0.855rem] font-medium text-white transition-colors hover:bg-accent-hover"
              >
                Subscribe
              </Link>
            </>
          )}
          <MobileNav items={NAV} signedIn={signedIn} />
        </div>
      </div>
    </header>
  );
}
