import { safeExternalUrl } from "@/lib/safe-url";

export type NoteSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:'"])/g;

/**
 * Splits a dataset note into text and safe link segments - contracts 2 and 4.
 *
 * A dataset states its own source, and a reader on a platform about checkable
 * provenance should be able to reach it, the way every Our World in Data chart
 * links its sources. But a note is text from a stranger's node, so a URL in it
 * is untrusted: it goes through safeExternalUrl, which admits only http(s) and
 * refuses javascript:, data:, and protocol-relative forms. A URL that does not
 * pass stays plain text - shown, not linked, so a reader sees what was written
 * without the reader's browser being pointed at it as a link.
 *
 * Trailing sentence punctuation is trimmed off the match so "see https://x.org."
 * links the URL and leaves the full stop as text.
 */
export function linkifyNote(note: string): NoteSegment[] {
  const segments: NoteSegment[] = [];
  let last = 0;

  for (const match of note.matchAll(URL_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: "text", text: note.slice(last, start) });

    const href = safeExternalUrl(raw);
    if (href) segments.push({ kind: "link", text: raw, href });
    else segments.push({ kind: "text", text: raw });

    last = start + raw.length;
  }

  if (last < note.length) segments.push({ kind: "text", text: note.slice(last) });
  return segments;
}
