import type { Metadata } from "next";
import Link from "next/link";

import { DatasetReader } from "@/components/dataset-reader";
import { getViewer } from "@/lib/auth/session";
import { registry } from "@/lib/signaling/registry";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: registry().find(id)?.item.title ?? id };
}

export default async function ReadDatasetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const located = registry().find(id);
  const viewer = await getViewer();

  if (!located) {
    return (
      <main className="mx-auto max-w-[40rem] px-5 py-20">
        <p className="font-mono text-[0.8rem] text-ink-faint">{id}</p>
        <h1 className="mt-4 font-serif text-[1.9rem] font-semibold leading-tight tracking-[-0.025em]">
          Nobody is serving this dataset
        </h1>
        <p className="mt-4 text-[1rem] leading-relaxed text-ink-muted">
          Which also means any column resolving a claim against it is currently
          unverifiable. Those claims will read as broken until whoever holds
          this data is serving it again.
        </p>
        <Link
          href="/read"
          className="mt-8 inline-block rounded-md bg-accent px-5 py-2.5 text-[0.9rem] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          See what is online
        </Link>
      </main>
    );
  }

  return (
    <DatasetReader
      address={located.presence.address}
      servedBy={located.presence.displayName}
      canExplore={viewer.tier !== "reader"}
    />
  );
}
