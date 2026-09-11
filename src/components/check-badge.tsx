import type { Conclusion } from "@/lib/claims/verdict";

const TONE: Record<
  Conclusion,
  { label: string; text: string; wash: string; dot: string; ring: string }
> = {
  passing: {
    label: "checks passing",
    text: "text-verified",
    wash: "bg-verified-wash",
    dot: "bg-verified",
    ring: "border-verified/30",
  },
  drifted: {
    label: "claim drifted",
    text: "text-drifted",
    wash: "bg-drifted-wash",
    dot: "bg-drifted",
    ring: "border-drifted/30",
  },
  broken: {
    label: "claim broken",
    text: "text-broken",
    wash: "bg-broken-wash",
    dot: "bg-broken",
    ring: "border-broken/30",
  },
  empty: {
    label: "no claims",
    text: "text-stale",
    wash: "bg-stale-wash",
    dot: "bg-stale",
    ring: "border-rule",
  },
};

export function CheckBadge({
  conclusion,
  counts,
  size = "sm",
}: {
  conclusion: Conclusion;
  counts?: { verified: number; drifted: number; broken: number };
  size?: "sm" | "md";
}) {
  const tone = TONE[conclusion];

  const label = counts
    ? conclusion === "passing"
      ? `${counts.verified} claim${counts.verified === 1 ? "" : "s"} verified`
      : conclusion === "drifted"
        ? `${counts.drifted} drifted · ${counts.verified} verified`
        : conclusion === "broken"
          ? `${counts.broken} broken · ${counts.verified} verified`
          : tone.label
    : tone.label;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${tone.ring} ${tone.wash} ${tone.text} ${
        size === "md"
          ? "px-2.5 py-1 text-[0.78rem]"
          : "px-2 py-0.5 text-[0.7rem]"
      } font-medium`}
    >
      <span className={`h-[6px] w-[6px] rounded-full ${tone.dot}`} aria-hidden />
      {label}
    </span>
  );
}
