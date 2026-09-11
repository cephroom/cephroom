import type { DiffHunk } from "@/lib/diff";

const ROW = {
  context: "",
  added: "bg-verified-wash",
  removed: "bg-broken-wash",
} as const;

const MARK = {
  context: " ",
  added: "+",
  removed: "−",
} as const;

const MARK_TONE = {
  context: "text-ink-faint",
  added: "text-verified",
  removed: "text-broken",
} as const;

/**
 * A unified diff. Line numbers on both sides, changed lines tinted with the
 * same two colours the verdict scale already uses, and each hunk scrolling
 * inside itself so a long line never widens the page.
 */
export function DiffView({ hunks }: { hunks: DiffHunk[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-rule">
      {hunks.map((hunk, index) => (
        <div key={`${hunk.beforeStart}-${index}`}>
          <div className="border-b border-rule bg-paper-sunken px-3 py-1.5 font-mono text-[0.7rem] text-ink-faint">
            @@ line {hunk.beforeStart} → {hunk.afterStart} @@
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-mono text-[0.76rem] leading-relaxed">
              <tbody>
                {hunk.lines.map((line, lineIndex) => (
                  <tr
                    key={`${index}-${lineIndex}`}
                    className={ROW[line.kind]}
                  >
                    <td className="w-10 select-none border-r border-rule px-2 text-right align-top text-ink-faint">
                      {line.before ?? ""}
                    </td>
                    <td className="w-10 select-none border-r border-rule px-2 text-right align-top text-ink-faint">
                      {line.after ?? ""}
                    </td>
                    <td
                      className={`w-5 select-none px-1.5 text-center align-top ${MARK_TONE[line.kind]}`}
                    >
                      {MARK[line.kind]}
                    </td>
                    <td className="whitespace-pre px-2 align-top">
                      {line.text || " "}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
