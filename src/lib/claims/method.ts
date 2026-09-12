/**
 * The analysis that produced a number.
 *
 * Pharmacology could get away without this. A median Ki is a property of a
 * receptor preparation, and a cell in the matrix has one value because there
 * is one way to take a median in log space.
 *
 * Neuroscience cannot. A decoding accuracy, a cluster-corrected activation, a
 * spectral peak is a property of **a pipeline applied to data**. NARPS put
 * seventy teams on one fMRI dataset and nine hypotheses: "the proportion of
 * teams reporting a significant effect ranged from 0% to 100%", and the
 * unthresholded maps correlated between r = −0.34 and r = 0.99. Teams
 * disagreed about the sign. Closer to home, the decoder benchmark this
 * platform now ships has EEG-TCNet at 59.45% under one evaluation protocol
 * and 70.00% under another — the same model, the same data, ten and a half
 * points apart.
 *
 * So a fact carries the method that produced it, and a claim names the method
 * it means.
 *
 * ## Why there is no default
 *
 * `scope:` defaults to `all`, and the consequence was found by auditing our
 * own shipped columns: every claim in all five was `scope: all`, not because
 * anyone chose to pool across organisms but because that is what you get by
 * not typing the line.
 *
 * NeuroVault shows where that ends. Its collection schema has 107 fields, of
 * which about sixty describe the pipeline — `software_package`,
 * `smoothing_fwhm`, `autocorrelation_model`, `group_inference_type` — added
 * years before NARPS proved they were decisive. On collection 4881, a
 * submission from one of the seventy NARPS teams, **ten fields are filled and
 * none of them is an analysis field.** Optional provenance is not collected. A
 * field nothing reads is a field nobody fills.
 *
 * The only version of this that survives contact with a deadline is one where
 * the number does not come out without it. So: where a cell exists under more
 * than one method, a claim that does not name one resolves **broken**, and
 * says which methods exist. Not a warning, not a footnote, and not a silently
 * pooled average — those are all just slower ways of not being told.
 *
 * Pure, and free of Node built-ins: the contributor's node resolves with this
 * and so does the reader's browser.
 */

/** Any fact-shaped record. Only the method and the value are read here. */
export interface Methoded {
  /** The analysis that produced this number, or null when there is only one. */
  method: string | null;
}

export type MethodResolution<T extends Methoded> =
  /** Exactly one candidate answers, and this is it. */
  | { kind: "resolved"; fact: T }
  /** No fact matches the rest of the query at all. */
  | { kind: "missing" }
  /**
   * The cell exists under several analyses and the claim named none. This is
   * the case the whole module is for.
   */
  | { kind: "ambiguous"; methods: string[] }
  /** The claim named a method this cell does not have. */
  | { kind: "unknown"; methods: string[] };

/** Methods present among the candidates, in first-seen order, de-duplicated. */
export function methodsOf<T extends Methoded>(candidates: T[]): string[] {
  const seen: string[] = [];
  for (const candidate of candidates) {
    if (candidate.method === null) continue;
    if (!seen.includes(candidate.method)) seen.push(candidate.method);
  }
  return seen;
}

/**
 * Picks the fact a claim meant.
 *
 * `requested` is the claim's `method:` line, or null when it has none.
 * Comparison is case-insensitive and trims, because a method name is typed by
 * hand in prose and "Online" and "online" are not two analyses.
 */
export function selectByMethod<T extends Methoded>(
  candidates: T[],
  requested: string | null,
): MethodResolution<T> {
  if (candidates.length === 0) return { kind: "missing" };

  const available = methodsOf(candidates);

  if (requested !== null && requested.trim() !== "") {
    const wanted = normalise(requested);
    const match = candidates.find(
      (candidate) =>
        candidate.method !== null && normalise(candidate.method) === wanted,
    );
    if (match) return { kind: "resolved", fact: match };

    // A dataset with a single unnamed analysis answers any claim about it —
    // but only if the claim did not ask for a method it does not have. Asking
    // for one it does not have is a real mismatch, not a near miss.
    return { kind: "unknown", methods: available };
  }

  // No method asked for.
  if (candidates.length === 1) return { kind: "resolved", fact: candidates[0] };

  // Several candidates. If they are all the same analysis — a dataset that
  // simply repeats a method name — there is still only one answer.
  if (available.length <= 1 && candidates.every((c) => c.method !== null)) {
    return { kind: "resolved", fact: candidates[0] };
  }

  return { kind: "ambiguous", methods: available };
}

/**
 * The spread of a cell's value across the analyses that produced it.
 *
 * The NARPS quantity, in the form this platform can check. `fold_spread`
 * already asserts how far *laboratories* disagree about a measurement; this
 * asserts how far *pipelines* disagree about the same data, which is a
 * different and often larger number and — per NARPS — the one that decides
 * whether a conclusion survives.
 *
 * Reported as a ratio, like the other fold selects, so an author writes
 * "1.18×" and the claim is dimensionless. Null when there is nothing to
 * compare: fewer than two methods, or any non-positive value, since a ratio
 * through zero is not a statement about disagreement.
 */
export function methodSpread<T extends Methoded & { value: number }>(
  candidates: T[],
): number | null {
  const named = candidates.filter((candidate) => candidate.method !== null);
  if (named.length < 2) return null;

  const values = named.map((candidate) => candidate.value);
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  if (min === 0) return null;
  return max / min;
}

function normalise(value: string): string {
  return value.trim().toLowerCase();
}
