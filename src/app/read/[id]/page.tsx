import type { Metadata } from "next";
import Link from "next/link";

import { ColumnReader } from "@/components/column-reader";
import { getViewer } from "@/lib/auth/session";
import { mintNodeKey } from "@/lib/keys/tokens";
import { registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const located = registry().find(id);
  // When nobody is serving it, the platform does not know its title, so the
  // page title is the id. That is not a gap - it is the contract holding.
  return { title: located?.item.title ?? id };
}

export default async function ReadColumnPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const located = registry().find(id);
  const viewer = await getViewer();

  if (!located) return <Offline id={id} />;

  // Every dataset currently being served, so the browser can resolve a claim
  // by fetching the dataset node directly.
  const datasets: Record<string, string> = {};
  for (const presence of registry().list()) {
    for (const item of presence.items) {
      if (item.kind === "dataset") datasets[item.id] = presence.address;
    }
  }

  const nodeKey = viewer.sub
    ? await mintNodeKey({
        sub: viewer.sub,
        tier: viewer.tier,
        name: viewer.name ?? undefined,
      })
    : null;

  return (
    <ColumnReader
      id={id}
      address={located.presence.address}
      servedBy={located.presence.displayName}
      datasets={datasets}
      nodeKey={nodeKey}
      tier={viewer.tier}
      signedIn={Boolean(viewer.sub)}
    />
  );
}

/**
 * What a reader sees when the contributor is not serving.
 *
 * Deliberately uninformative. A helpful "Three empty cells, by Marcus
 * Oyelaran — currently offline" would require the platform to have kept the
 * title, which is the thing Contract 2 forbids. All this page has is the id
 * that was in the URL.
 */
function Offline({ id }: { id: string }) {
  return (
    <main className="mx-auto max-w-[40rem] px-5 py-20">
      <p className="font-mono text-[0.8rem] text-ink-faint">{id}</p>

      <h1 className="mt-4 font-serif text-[1.9rem] font-semibold leading-tight tracking-[-0.025em]">
        Nobody is serving this right now
      </h1>

      <p className="mt-4 text-[1rem] leading-relaxed text-ink-muted">
        Bindery stores nothing. Whatever was at this address lived on its
        author&rsquo;s machine and was served from there; their node is not
        running, so there is nothing to show and nothing cached to fall back
        on.
      </p>

      <p className="mt-4 text-[0.92rem] leading-relaxed text-ink-muted">
        We cannot tell you its title, who wrote it, or when it was last
        available — none of that was ever kept here. All the platform had was
        an address to forward you to while the author was online.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/read"
          className="rounded-md bg-accent px-5 py-2.5 text-[0.9rem] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          See what is online
        </Link>
        <Link
          href="/how-it-works"
          className="rounded-md border border-rule-strong px-5 py-2.5 text-[0.9rem] font-medium transition-colors hover:border-ink-faint"
        >
          Why it works this way
        </Link>
      </div>
    </main>
  );
}
