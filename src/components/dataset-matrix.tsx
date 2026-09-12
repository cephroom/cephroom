import { formatValue } from "@/lib/claims/syntax";

export interface MatrixCell {
  display: string;
  nPoints: number | null;
  nDocs: number | null;
  foldSpreadIqr: number | null;
}

export function describeAgreement(fold: number): {
  word: string;
  tone: string;
} {
  if (fold <= 2.5) return { word: "tight", tone: "text-verified" };
  if (fold <= 4) return { word: "mixed", tone: "text-ink-muted" };
  return { word: "loose", tone: "text-drifted" };
}

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
    <div
      className="mt-5 overflow-x-auto rounded-xl border border-rule"
      role="region"
      aria-label="Affinity matrix - scroll sideways for more columns"
      tabIndex={0}
    >
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
