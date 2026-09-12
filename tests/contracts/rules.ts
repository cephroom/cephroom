import type { Rule } from "./scan";

/**
 * The source rules the contract tests enforce, in one place.
 *
 * They live here rather than inline for a reason that is itself a finding:
 * a rule and the proof that the rule works have to be the same object. When
 * `tests/contracts/scanner.test.ts` re-declared a rule in order to test it,
 * the copy under test and the copy doing the work were free to drift — and a
 * rule that has quietly stopped matching anything looks exactly like a rule
 * that is passing.
 *
 * So: every rule exported here is applied by a contract test, and every rule
 * exported here is fed known violations by the scanner test. Adding one
 * without doing both is the thing to catch in review.
 */

/** The one permitted write path: the simulated counterparty, by directory. */
export const SIMULATED = "simulated-counterparties/";

/**
 * Nothing in the platform writes bytes anywhere.
 *
 * Scanned over `src` *and* `simulated-counterparties`, so the allowlist below
 * actually exempts something. Pointed at `src` alone — as it was — the allow
 * prefix named a directory the scan never visited, which made the exemption
 * and the test guarding the exemption both vacuous.
 */
export const FS_WRITE_RULE: Rule = {
  name: "fs-write",
  pattern:
    /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|mkdirSync|mkdir|rmSync|unlinkSync|renameSync|copyFileSync)\s*\(/,
  allow: [SIMULATED],
};

/** Stronger than banning the call names: the module is not even in scope. */
export const FS_IMPORT_RULE: Rule = {
  name: "fs-import",
  raw: true,
  pattern: /from\s*["']node:fs["']|from\s*["']fs["']|require\(\s*["'](node:)?fs["']/,
  allow: [SIMULATED],
};

/**
 * The platform never reads the client IP. A node states its own address.
 *
 * `raw`, because every spelling of this is a string literal at the only point
 * it can appear. Without it the rule reduced
 * `request.headers.get("x-forwarded-for")` to `request.headers.get( )` and
 * matched nothing — the most confident assertion in the suite, inert.
 */
export const CLIENT_IP_RULE: Rule = {
  name: "client-ip",
  raw: true,
  pattern:
    /x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip|fastly-client-ip|\bremoteAddress\b|\b(request|req)\.ip\b|\bgeolocation\b/i,
};

/**
 * The platform writes no logs.
 *
 * Enumerating the ways a subject can reach a log is a losing game — the rule
 * this replaces caught `console.log("sub", sub)` and missed
 * `console.log(`signed in ${sub}`)`, `console.log(viewer)` and
 * `logger.info({ sub })`. There is no request the platform handles where a
 * log line would be about the platform rather than about a person using it,
 * so it does not log. A node logs freely; a node is its owner's own machine.
 */
export const NO_LOGGING_RULES: Rule[] = [
  { name: "console-call", pattern: /\bconsole\s*\.\s*\w+\s*\(/ },
  {
    name: "logger-call",
    pattern:
      /\b(logger|log|pino|winston|bunyan)\s*\.\s*(log|info|warn|error|debug|trace)\s*\(/,
  },
];

/** Analytics arriving as a dependency is caught elsewhere; as a URL, here. */
export const TELEMETRY_RULE: Rule = {
  name: "telemetry-endpoint",
  raw: true,
  pattern:
    /sentry\.io|ingest\.sentry|posthog\.com|\bmixpanel\b|segment\.(io|com)|amplitude\.com|google-analytics\.com|googletagmanager|datadoghq|\/collect\b|\bbeacon\b/i,
};

/**
 * Mutable process state, at module scope.
 *
 * Anchored at column zero, because that is what separates process state from
 * a scratch collection inside a render or a parser. One built and dropped
 * within a call never outlives the request; one at module scope outlives
 * every request the process serves, which is the distinction the contract
 * turns on.
 *
 * `ReadonlySet`/`ReadonlyMap` are excluded — a frozen table of status strings
 * is a constant, not state. The lookahead sits immediately after the colon
 * rather than after `\s*`: written the other way, the optional whitespace
 * backtracks to zero width and the lookahead passes on the space instead of
 * on the type, which let the exclusion match everything it was meant to spare.
 */
export const MUTABLE_GLOBAL_RULE: Rule = {
  name: "mutable-global",
  pattern:
    /\b(globalThis|global)\b[^=\n]*\bas\b|\?\?=\s*new\s+(Map|Set|WeakMap|WeakSet)\b|^(export\s+)?(const|let|var)\s+\w+\s*(:(?!\s*Readonly(Set|Map)\b)[^=]+)?=\s*new\s+(Map|Set|WeakMap|WeakSet)\b/,
};

/**
 * Durable state reached over HTTP.
 *
 * Every other storage rule looks for a filesystem call, an import, or a
 * package name. A hosted key-value store needs none of those — it is a
 * `fetch` to a URL, and it would have passed the entire suite. The platform
 * already makes outbound requests (to the identity provider and to Stripe),
 * so there is no "makes no network calls" baseline to fall back on; the hosts
 * have to be named.
 */
export const REMOTE_STORE_RULE: Rule = {
  name: "remote-store",
  raw: true,
  pattern:
    /upstash\.io|supabase\.co|firebaseio\.com|firestore\.googleapis|\.rds\.amazonaws|documents\.azure\.com|blob\.vercel-storage\.com|\.convex\.cloud|planetscale|neon\.tech|turso\.io|mongodb(\+srv)?:\/\/|postgres(ql)?:\/\/|mysql:\/\/|redis(s)?:\/\//i,
};
