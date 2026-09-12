export interface CellFold {
  all: number | null;
  iqrAll: number | null;
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
