
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
  method: string | null;
  select: ClaimSelect;
  expectedValue: number | null;
  expectedUnit: string | null;
  tolerance: ClaimTolerance;
  label: string | null;
  source: string;
}

export interface ClaimParseError {
  key: string | null;
  message: string;
  source: string;
}

export interface ParsedBody {
  prose: string;
  claims: ParsedClaim[];
  errors: ClaimParseError[];
  referenced: string[];
}

const CLAIM_BLOCK = /^```claim[ \t]+([A-Za-z0-9][\w-]*)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;
const INLINE_REF = /\{\{claim:([A-Za-z0-9][\w-]*)\}\}/g;

const REQUIRED = ["dataset", "metric", "subject", "object"] as const;

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
