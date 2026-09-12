import type { Metadata } from "next";
import Link from "next/link";

import { NodeProposalList } from "@/components/node-proposal-list";
import { getViewer } from "@/lib/auth/session";
import { mintNodeKey } from "@/lib/keys/tokens";
import { registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Proposals" };

export default async function ProposalsPage({
  params,
}: {
  params: Promise<{ sub: string; id: string }>;
}) {
  const { sub: rawSub, id: rawId } = await params;
  const sub = decodeURIComponent(rawSub);
  const id = decodeURIComponent(rawId);
  const located = registry().find(sub, id);
  const viewer = await getViewer();

  // Reading proposals is open — the node checks nothing — but a signed-in
  // reader still gets a node key, because the same page offers to write one
  // and a proposal has to be attributable. Same short-lived key the column
  // reader uses.
  const nodeKey = viewer.sub
    ? await mintNodeKey({
        sub: viewer.sub,
        audience: sub,
        sessionSecondsLeft: viewer.expiresIn,
      })
    : null;

  if (!located) {
    return (
      <main className="mx-auto max-w-[40rem] px-5 py-20">
        <h1 className="font-serif text-[1.8rem] font-semibold tracking-[-0.025em]">
          Nobody is serving this
        </h1>
        <p className="mt-4 text-[0.98rem] leading-relaxed text-ink-muted">
          Proposals live on the author&rsquo;s machine alongside the column, so
          they are readable only while that machine is serving.
        </p>
        <Link
          href="/read"
          className="mt-6 inline-block rounded-md bg-accent px-5 py-2.5 text-[0.9rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
        >
          See what is online
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[46rem] px-5 py-12">
      <Link
        href={`/read/${sub}/${id}`}
        className="text-[0.82rem] text-ink-faint transition-colors hover:text-ink"
      >
        ← {located.item.title}
      </Link>

      <header className="mt-6 flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-6">
        <div>
          <h1 className="font-serif text-[1.9rem] font-semibold tracking-[-0.025em]">
            Proposals
          </h1>
          <p className="mt-2 max-w-[54ch] text-[0.93rem] leading-relaxed text-ink-muted">
            Held on {located.presence.displayName}&rsquo;s machine, fetched
            straight from it. None of this passes through Cephroom.
          </p>
        </div>
        <Link
          href={`/read/${sub}/${id}/propose`}
          className="shrink-0 rounded-md bg-accent px-4 py-2 text-[0.86rem] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
        >
          Propose an edit
        </Link>
      </header>

      <NodeProposalList
        columnId={id}
        address={located.presence.address}
        nodeKey={nodeKey}
      />
    </main>
  );
}
