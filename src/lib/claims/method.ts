
export interface Methoded {
  method: string | null;
}

export type MethodResolution<T extends Methoded> =
  | { kind: "resolved"; fact: T }
  | { kind: "missing" }
  | { kind: "ambiguous"; methods: string[] }
  | { kind: "unknown"; methods: string[] };

export function methodsOf<T extends Methoded>(candidates: T[]): string[] {
  const seen: string[] = [];
  for (const candidate of candidates) {
    if (candidate.method === null) continue;
    if (!seen.includes(candidate.method)) seen.push(candidate.method);
  }
  return seen;
}

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

    return { kind: "unknown", methods: available };
  }

  if (candidates.length === 1) return { kind: "resolved", fact: candidates[0] };

  if (available.length <= 1 && candidates.every((c) => c.method !== null)) {
    return { kind: "resolved", fact: candidates[0] };
  }

  return { kind: "ambiguous", methods: available };
}

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
