import Link from "next/link";

import { CheckBadge } from "@/components/check-badge";
import { formatDate, type FeedItem } from "@/lib/columns";

const ACCESS_CHIP: Record<FeedItem["access"], string | null> = {
  public: null,
  member: "Member",
  lab: "Lab",
};

export function ColumnCard({ item }: { item: FeedItem }) {
  const chip = ACCESS_CHIP[item.access];

  return (
    <li className="border-b border-rule">
      <Link href={`/columns/${item.slug}`} className="group block py-7">
        <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.78rem] text-ink-faint">
          <span>{item.author.name ?? "Bindery"}</span>
          <span aria-hidden>·</span>
          <time>{formatDate(item.publishedAt)}</time>
          {item.readingMinutes && (
            <>
              <span aria-hidden>·</span>
              <span>{item.readingMinutes} min</span>
            </>
          )}
          {chip && (
            <span className="rounded-full border border-rule-strong px-1.5 py-px text-[0.68rem] font-medium uppercase tracking-[0.06em] text-ink-muted">
              {chip}
            </span>
          )}
        </div>

        <h3 className="font-serif text-[1.32rem] font-semibold leading-snug tracking-[-0.015em] text-ink decoration-accent/40 underline-offset-4 group-hover:underline">
          {item.title}
        </h3>

        {item.excerpt && (
          <p className="mt-2 max-w-[60ch] text-[0.92rem] leading-relaxed text-ink-muted">
            {item.excerpt}
          </p>
        )}

        <div className="mt-3.5">
          <CheckBadge conclusion={item.check.conclusion} counts={item.check} />
        </div>
      </Link>
    </li>
  );
}
