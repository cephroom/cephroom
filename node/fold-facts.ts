/**
 * Which fold-spread numbers ride on a fact, given its scope.
 *
 * Fold spread describes a cell's point cloud, so it attaches to every metric
 * of that cell. But the report computes an interquartile fold spread only for
 * the whole-cell distribution — there is no human-only IQR — so a human-scope
 * fold-IQR claim must resolve to broken rather than silently borrowing the
 * all-scope number. This is the paywall-adjacent honesty rule of the dataset,
 * pulled into one pure function so a test can hold it.
 */
export interface CellFold {
  /** Whole-cell fold spread (loosest / tightest). */
  all: number | null;
  /** Whole-cell interquartile fold spread. */
  iqrAll: number | null;
  /** Human-only fold spread, when the report computed one. */
  human: number | null;
}

export function foldForScope(
  fold: CellFold,
  scope: string,
): { foldSpread: number | null; foldSpreadIqr: number | null } {
  const human = scope === "human";
  return {
    foldSpread: human ? fold.human : fold.all,
    // No human-only IQR exists; a human-scope fold-IQR claim goes broken
    // rather than borrowing the all-scope figure.
    foldSpreadIqr: human ? null : fold.iqrAll,
  };
}
