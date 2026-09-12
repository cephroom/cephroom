/**
 * Claim syntax
 * ============
 *
 * A column body is Markdown with two extra constructs.
 *
 * 1. An inline reference, written in the prose where the number belongs:
 *
 *        Haloperidol binds D2 at {{claim:hal-d2}}.
 *
 * 2. A fenced definition block that says what that number *is* - a query
 *    against a versioned dataset, plus the value the author observed when
 *    they wrote the sentence:
 *
 *        ```claim hal-d2
 *        dataset: receptorome-ki
 *        metric: median_ki_nm
 *        subject: DRD2
 *        object: haloperidol
 *        scope: all
 *        value: 1.55 nM
 *        tolerance: 15%
 *        ```
 *
 *    Where a dataset holds the same cell under more than one analysis — an
 *    evaluation protocol, a preprocessing pipeline — the claim must also name
 *    which one it means:
 *
 *        ```claim tcnet-online
 *        dataset: mi-decoders-2025
 *        metric: accuracy_pct
 *        subject: EEG-TCNet
 *        object: four-class-motor-imagery
 *        method: online
 *        value: 70.0 %
 *        tolerance: 2%
 *        ```
 *
 *    Leaving `method:` out there is not a shortcut to a sensible default; it
 *    resolves broken and names the analyses that exist. lib/claims/method.ts
 *    says why.
 *
 * The author never types a bare number into the prose. The number is
 * rendered from the dataset at read time, and the `value:` line is what CI
 * compares against - so if the dataset moves, the sentence is flagged
 * rather than quietly becoming wrong.
 *
 * This module is pure: no database, no I/O. It is the contract that both
 * the editor preview and the CI runner parse with.
 */

export type ClaimSelect =
  | "value"
  | "n_points"
  | "n_docs"
  | "fold_spread"
  | "fold_spread_iqr"
  | "censored_fraction"
  | "pdsp_fold"
  | "method_spread"
  | "dispersion";

/**
 * The dimensionless selects. Fold spread is a ratio of the loosest to the
 * tightest measurement in a cell (`fold_spread`) or across its interquartile
 * range (`fold_spread_iqr`). A claim on one of these asserts *agreement
 * between labs* rather than a point estimate — often the real scientific
 * point, since a cell can have a tight median and a 100x full spread. The
 * value is a bare ratio, so "5x", "5-fold", "×5" and "5" all mean the same
 * thing; we drop the fold notation, wherever it sits, so it never reads as a
 * unit mismatch, and reject a non-positive ratio as not a real assertion.
 */
export const FOLD_SELECTS: ClaimSelect[] = [
  "fold_spread",
  "fold_spread_iqr",
  // The ChEMBL-vs-PDSP fold difference is a ratio too, rendered "1.33×", and
  // shares the bare-ratio parsing (drop notation, reject non-positive).
  "pdsp_fold",
  // How far the *analyses* of the same data disagree, as opposed to how far
  // the laboratories do. See lib/claims/method.ts — this is the NARPS
  // quantity, and it is a ratio like the rest.
  "method_spread",
];

export function isFoldSelect(select: ClaimSelect): boolean {
  return FOLD_SELECTS.includes(select);
}

export interface ClaimTolerance {
  /** "percent" compares relative drift, "absolute" compares raw difference. */
  kind: "percent" | "absolute";
  amount: number;
}

export interface ParsedClaim {
  key: string;
  datasetSlug: string;
  metric: string;
  subject: string;
  object: string;
  scope: string;
  /**
   * The analysis this claim means, or null when it names none.
   *
   * Deliberately has **no default**, unlike `scope`. Where a cell exists under
   * more than one analysis, a claim that leaves this out resolves broken. See
   * lib/claims/method.ts for why, and for what happened to the one field set
   * that made it optional.
   */
  method: string | null;
  select: ClaimSelect;
  expectedValue: number | null;
  expectedUnit: string | null;
  tolerance: ClaimTolerance;
  /** Optional prose label rendered next to the value. */
  label: string | null;
  source: string;
}

export interface ClaimParseError {
  key: string | null;
  message: string;
  source: string;
}

export interface ParsedBody {
  /** The body with claim definition blocks stripped out. */
  prose: string;
  claims: ParsedClaim[];
  errors: ClaimParseError[];
  /** Keys referenced by {{claim:...}} in the prose. */
  referenced: string[];
}

const CLAIM_BLOCK = /^```claim[ \t]+([A-Za-z0-9][\w-]*)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;
const INLINE_REF = /\{\{claim:([A-Za-z0-9][\w-]*)\}\}/g;

const REQUIRED = ["dataset", "metric", "subject", "object"] as const;

/** Collapses CRLF and lone CR to LF. */
export function normaliseNewlines(text: string): string {
  return text.split("\r\n").join("\n").split("\r").join("\n");
}

const SELECTS: ClaimSelect[] = [
  "value",
  "n_points",
  "n_docs",
  "fold_spread",
  "fold_spread_iqr",
  "censored_fraction",
  "pdsp_fold",
  "method_spread",
  "dispersion",
];

/** Pulls `{{claim:key}}` keys out of prose, in document order, deduplicated. */
export function referencedKeys(prose: string): string[] {
  const seen = new Set<string>();
  for (const match of prose.matchAll(INLINE_REF)) seen.add(match[1]);
  return [...seen];
}

function parseTolerance(raw: string | undefined): ClaimTolerance {
  if (!raw) return { kind: "percent", amount: 10 };
  const text = raw.trim().replace(/^[±+-]/, "");
  if (text.endsWith("%")) {
    const amount = Number.parseFloat(text.slice(0, -1));
    return {
      kind: "percent",
      amount: Number.isFinite(amount) ? Math.abs(amount) : 10,
    };
  }
  const amount = Number.parseFloat(text);
  return Number.isFinite(amount)
    ? { kind: "absolute", amount: Math.abs(amount) }
    : { kind: "percent", amount: 10 };
}

/**
 * Splits "1.55 nM" into value and unit. A bare number yields a null unit,
 * which is correct for dimensionless metrics such as pKi and document counts.
 */
export function parseMeasurement(raw: string | undefined): {
  value: number | null;
  unit: string | null;
} {
  if (!raw) return { value: null, unit: null };
  const match = raw.trim().match(/^(-?[\d.]+(?:[eE][-+]?\d+)?)\s*(.*)$/);
  if (!match) return { value: null, unit: null };
  const value = Number.parseFloat(match[1]);
  const unit = match[2].trim();
  return {
    value: Number.isFinite(value) ? value : null,
    unit: unit.length > 0 ? unit : null,
  };
}

function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf(":");
    if (sep === -1) continue;
    const key = trimmed.slice(0, sep).trim().toLowerCase();
    const value = trimmed.slice(sep + 1).trim();
    if (key.length > 0) fields[key] = value;
  }
  return fields;
}

export function parseBody(rawBody: string): ParsedBody {
  // HTML normalises textarea values to CRLF on form submission, which breaks
  // the fence patterns below, which anchor on a bare newline. Normalising
  // here means the parser behaves identically whether a body arrived
  // through a form, a server action argument, or a seed file.
  const body = normaliseNewlines(rawBody);
  const claims: ParsedClaim[] = [];
  const errors: ClaimParseError[] = [];
  const seenKeys = new Set<string>();

  const prose = body
    .replace(CLAIM_BLOCK, (source, key: string, fieldText: string) => {
      const fields = parseFields(fieldText);

      const missing = REQUIRED.filter((name) => !fields[name]);
      if (missing.length > 0) {
        errors.push({
          key,
          message: `Claim "${key}" is missing: ${missing.join(", ")}.`,
          source,
        });
        return "";
      }

      if (seenKeys.has(key)) {
        errors.push({
          key,
          message: `Claim "${key}" is defined more than once.`,
          source,
        });
        return "";
      }
      seenKeys.add(key);

      const selectRaw = (fields.select ?? "value").toLowerCase();
      const select = SELECTS.includes(selectRaw as ClaimSelect)
        ? (selectRaw as ClaimSelect)
        : "value";
      if (!SELECTS.includes(selectRaw as ClaimSelect)) {
        errors.push({
          key,
          message: `Claim "${key}" has unknown select "${selectRaw}". Expected one of ${SELECTS.join(", ")}.`,
          source,
        });
      }

      const parsed = parseMeasurement(fields.value);
      // A fold spread is a bare ratio. "5x", "5-fold", "×5" and "5" are the
      // same assertion, so the fold notation is not treated as a unit —
      // otherwise it would read as a unit mismatch against the dimensionless
      // observed value and the claim would go broken. parseMeasurement only
      // strips a *trailing* notation, so for a fold select pull the first
      // number out wherever it sits, and never let a nonsensical negative
      // ratio through.
      let value = parsed.value;
      if (isFoldSelect(select)) {
        if (value === null) {
          const match = fields.value?.match(/-?[\d.]+(?:[eE][-+]?\d+)?/);
          value = match ? Number.parseFloat(match[0]) : null;
        }
        if (value !== null && value <= 0) value = null;
      } else if (select === "censored_fraction") {
        // A fraction in [0, 1]. Accept "7%" as 0.07 and "0.07" as itself;
        // anything outside [0, 1] is not a fraction, so record no value.
        if (value !== null && parsed.unit === "%") value = value / 100;
        if (value !== null && (value < 0 || value > 1)) value = null;
      }
      const expectedUnit =
        isFoldSelect(select) || select === "censored_fraction"
          ? null
          : parsed.unit;

      claims.push({
        key,
        datasetSlug: fields.dataset,
        metric: fields.metric,
        subject: fields.subject,
        object: fields.object,
        scope: (fields.scope ?? "all").toLowerCase(),
        // No `?? "all"`. An absent method is absent, not a pooled one.
        method: fields.method ? fields.method.trim() : null,
        select,
        expectedValue: value,
        expectedUnit,
        tolerance: parseTolerance(fields.tolerance),
        label: fields.label ?? null,
        source,
      });

      return "";
    })
    // Definition blocks leave blank runs behind; collapse them so the prose
    // does not gain stray paragraph breaks where a claim used to sit.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const referenced = referencedKeys(prose);

  for (const key of referenced) {
    if (!seenKeys.has(key)) {
      errors.push({
        key,
        message: `The prose references {{claim:${key}}} but no claim block defines it.`,
        source: `{{claim:${key}}}`,
      });
    }
  }

  for (const claim of claims) {
    if (!referenced.includes(claim.key)) {
      errors.push({
        key: claim.key,
        message: `Claim "${claim.key}" is defined but never referenced in the prose.`,
        source: claim.source,
      });
    }
  }

  return { prose, claims, errors, referenced };
}

/** Formats a measured value for display, with sensible significant figures. */
export function formatValue(
  value: number | null | undefined,
  unit?: string | null,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const magnitude = Math.abs(value);
  let text: string;
  if (magnitude === 0) text = "0";
  else if (magnitude >= 1000) text = value.toFixed(0);
  else if (magnitude >= 100) text = value.toFixed(1);
  else if (magnitude >= 10) text = value.toFixed(2);
  else if (magnitude >= 1) text = value.toFixed(2);
  else if (magnitude >= 0.01) text = value.toFixed(3);
  else text = value.toPrecision(2);

  // Trim trailing zeros but keep at least one decimal place for sub-10 values.
  if (text.includes(".")) text = text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return unit ? `${text} ${unit}` : text;
}
