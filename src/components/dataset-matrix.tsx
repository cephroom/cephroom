import { formatValue } from "@/lib/claims/syntax";

export interface MatrixCell {
  display: string;
  nPoints: number | null;
  nDocs: number | null;
  /** Interquartile fold spread — how well the labs agree. Null if unknown. */
  foldSpreadIqr: number | null;
}

/**
 * How the middle-half spread reads at a glance. The thresholds are this
 * dataset's own quartiles (median IQR fold spread ~2.25x, upper quartile
 * ~3.9x), so "tight" and "loose" mean tight and loose relative to the data,
 * not an arbitrary line. The word carries the meaning; the colour only
 * reinforces it, so a reader who cannot see the colour loses nothing.
 */
export function describeAgreement(fold: number): {
  word: string;
  tone: string;
} {
  if (fold <= 2.5) return { word: "tight", tone: "text-verified" };
  if (fold <= 4) return { word: "mixed", tone: "text-ink-muted" };
  return { word: "loose", tone: "text-drifted" };
}

/**
 * The targets-by-compounds grid. Each populated cell carries its evidence
 * count underneath the value, because a cell resting on one paper and a cell
 * resting on ninety-three should not look identical. Empty cells render as a
 * middle dot and are enumerated by name below the table, never zero-filled.
 */
export function DatasetMatrix({
  subjects,
  objects,
  cells,
  unit,
  highlight,
}: {
  subjects: string[];
  objects: string[];
  cells: Map<string, MatrixCell>;
  unit: string | null;
  highlight: { subject: string; object: string } | null;
}) {
  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-rule">
      <table className="w-full border-collapse text-[0.82rem]">
        <caption className="sr-only">
          Measured values by target and compound
          {unit ? `, in ${unit}` : ""}.
        </caption>
        <thead>
          <tr className="bg-paper-sunken">
            <th
              scope="col"
              className="sticky left-0 z-10 border-b border-r border-rule bg-paper-sunken px-3 py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-ink-faint"
            >
              Target
              {unit && (
                <span className="ml-1 font-mono lowercase tracking-normal">
                  ({unit})
                </span>
              )}
            </th>
            {objects.map((object) => (
              <th
                key={object}
                scope="col"
                className="border-b border-rule px-3 py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.06em] text-ink-faint"
              >
                {object}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {subjects.map((subject) => (
            <tr key={subject} className="border-b border-rule last:border-0">
              <th
                scope="row"
                className="sticky left-0 z-10 border-r border-rule bg-paper px-3 py-2 text-left font-mono text-[0.8rem] font-semibold"
              >
                {subject}
              </th>
              {objects.map((object) => {
                const cell = cells.get(`${subject}|${object}`);
                const isHighlight =
                  highlight?.subject === subject &&
                  highlight?.object === object;

                return (
                  <td
                    key={object}
                    className={`px-3 py-2 align-top ${
                      isHighlight ? "bg-accent-wash" : ""
                    }`}
                  >
                    {cell ? (
                      <>
                        <span className="block font-mono tnum">
                          {cell.display}
                        </span>
                        {cell.nPoints !== null && (
                          <span className="mt-0.5 block text-[0.68rem] tnum text-ink-faint">
                            n={cell.nPoints}
                            {cell.nDocs !== null && ` · ${cell.nDocs} papers`}
                          </span>
                        )}
                        {cell.foldSpreadIqr !== null &&
                          (() => {
                            const agree = describeAgreement(cell.foldSpreadIqr);
                            return (
                              <span
                                className={`mt-0.5 block text-[0.68rem] tnum ${agree.tone}`}
                                title="Interquartile fold spread: how far the middle half of the measurements disagree. Lower is tighter agreement between labs."
                              >
                                IQR {formatValue(cell.foldSpreadIqr)}× {agree.word}
                              </span>
                            );
                          })()}
                      </>
                    ) : (
                      <span
                        className="block text-ink-faint"
                        title="No data of this kind for this cell"
                      >
                        ·
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
