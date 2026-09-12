// Typed ReadonlySet so the mutable-global scan spares it, which is the
// documented escape hatch for a frozen lookup table rather than a way round
// the rule: this is never written to after construction. The scan caught it on
// first run, which is the rule working.
const ALLOWED: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * Whether a URL a node supplied is safe to attach to an href - contract 4.
 *
 * An announced address is a claim the reader checks. So is everything else a
 * node says, and a URL is the sharp case: a column's front matter reaches an
 * href without passing through anything, and front matter is a file on a
 * stranger's machine.
 *
 * This existed as a dependency on React. React 19 blocks javascript: hrefs;
 * React 16 and 18 only warned about them. Resting a security property on which
 * release happens to be installed is the failure this suite is built to catch,
 * because a protection that has quietly stopped applying looks identical to one
 * that is working.
 *
 * Returns the URL unchanged or null. It does not rewrite, because rewriting is
 * a decision about what somebody's link meant; the only question here is
 * whether it is safe to attach. Protocol-relative URLs are refused - next to a
 * repository label they read as a path and navigate to another origin.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("//")) return null;

  try {
    return ALLOWED.has(new URL(trimmed).protocol) ? value : null;
  } catch {
    return null;
  }
}
