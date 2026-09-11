import type { Metadata } from "next";
import Link from "next/link";

import { ColumnReader } from "@/components/column-reader";
import { DatasetReader } from "@/components/dataset-reader";
import { getViewer } from "@/lib/auth/session";
import { mintNodeKey } from "@/lib/keys/tokens";
import { registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sub: string; id: string }>;
}): Promise<Metadata> {
  const { sub, id } = await params;
  const located = registry().find(decodeURIComponent(sub), decodeURIComponent(id));
  // Offline, the platform does not know the title — it is not a gap, it is
  // the contract holding — so the page title falls back to the id.
  return { title: located?.item.title ?? decodeURIComponent(id) };
}

export default async function ReadItemPage({
  params,
}: {
  params: Promise<{ sub: string; id: string }>;
}) {
  const { sub: rawSub, id: rawId } = await params;
  const sub = decodeURIComponent(rawSub);
  const id = decodeURIComponent(rawId);

  const located = registry().find(sub, id);
  const viewer = await getViewer();

  if (!located) return <Offline sub={sub} id={id} />;

  if (located.item.kind === "dataset") {
    return (
      <DatasetReader
        address={located.presence.address}
        servedBy={located.presence.displayName}
        datasetId={id}
        canExplore={viewer.tier !== "reader"}
      />
    );
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
      sub={sub}
      id={id}
      address={located.presence.address}
      servedBy={located.presence.displayName}
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
 * title, which is the thing Contract 2 forbids. All this page has is the
 * contributor and id that were in the URL.
 */
function Offline({ sub, id }: { sub: string; id: string }) {
  return (
    <main className="mx-auto max-w-[40rem] px-5 py-20">
      <p className="font-mono text-[0.8rem] text-ink-faint">
        {sub} / {id}
      </p>

      <h1 className="mt-4 font-serif text-[1.9rem] font-semibold leading-tight tracking-[-0.025em]">
        Nobody is serving this right now
      </h1>

      <p className="mt-4 text-[1rem] leading-relaxed text-ink-muted">
        Receptorome stores nothing. Whatever was at this address lived on its
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
