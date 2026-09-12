import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { NodeProposalForm } from "@/components/node-proposal-form";
import { getViewer } from "@/lib/auth/session";
import { mintNodeKey } from "@/lib/keys/tokens";
import { registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Propose an edit" };

export default async function ProposePage({
  params,
}: {
  params: Promise<{ sub: string; id: string }>;
}) {
  const { sub: rawSub, id: rawId } = await params;
  const sub = decodeURIComponent(rawSub);
  const id = decodeURIComponent(rawId);
  const located = registry().find(sub, id);
  const viewer = await getViewer();

  if (!viewer.sub) {
    redirect(`/signin?next=${encodeURIComponent(`/read/${sub}/${id}/propose`)}`);
  }
  if (!located) {
    return (
      <main className="mx-auto max-w-[40rem] px-5 py-20">
        <h1 className="font-serif text-[1.8rem] font-semibold tracking-[-0.025em]">
          Nobody is serving this
        </h1>
        <p className="mt-4 text-[0.98rem] leading-relaxed text-ink-muted">
          A proposal goes straight to the author&rsquo;s machine, so it can only
          be made while they are online. There is no queue here to leave it in
          — that would mean the platform holding your edit.
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

  const nodeKey = await mintNodeKey({
    sub: viewer.sub,
    tier: viewer.tier,
    audience: sub,
    sessionSecondsLeft: viewer.expiresIn,
  });

  return (
    <main className="mx-auto max-w-4xl px-5 py-12">
      <Link
        href={`/read/${sub}/${id}`}
        className="text-[0.82rem] text-ink-faint transition-colors hover:text-ink"
      >
        ← {located.item.title}
      </Link>

      <header className="mt-6 border-b border-rule pb-6">
        <h1 className="font-serif text-[1.9rem] font-semibold tracking-[-0.025em]">
          Propose an edit
        </h1>
        <p className="mt-2.5 max-w-[60ch] text-[0.95rem] leading-relaxed text-ink-muted">
          This goes directly to {located.presence.displayName}&rsquo;s machine
          and is stored there, next to the column. Cephroom neither holds it nor
          sees it — your browser posts it to their node, the same way it
          fetched the text.
        </p>
      </header>

      <NodeProposalForm
        sub={sub}
        columnId={id}
        address={located.presence.address}
        nodeKey={nodeKey}
        canPropose={viewer.tier !== "reader"}
      />
    </main>
  );
}
