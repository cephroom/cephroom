import type { Rule } from "./scan";


/**
 * The only path exempt from the write and filesystem rules, and the reason it
 * is a path rather than a flag.
 *
 * Two counterparties cannot be provisioned on a developer machine: a Google
 * OAuth client and a Stripe account. Both are handled by mocking the
 * COUNTERPARTY rather than this platform's own code, so reading a subscription,
 * minting a key and stamping the plan into it are the production paths in
 * development too. A mock of our own billing logic would test nothing.
 *
 * The stand-in has to persist customers the way Stripe does, which means
 * writing a file - the one thing every other module is forbidden. Keeping the
 * exemption as a directory prefix means it is visible in a diff the moment
 * anything else tries to claim it.
 *
 * no-user-data.test.ts guards the exemption three ways: that it is the only
 * one, that the scan actually visits the directory it exempts (an allowlist
 * over a directory nobody scans hides nothing and protects nothing), and that
 * with the allowlist removed this is the ONLY file caught. That last one is the
 * negative control: an empty result would mean the rule had stopped matching,
 * which looks identical to the rule passing.
 */
export const SIMULATED = "simulated-counterparties/";

export const FS_WRITE_RULE: Rule = {
  name: "fs-write",
  pattern:
    /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|mkdirSync|mkdir|rmSync|unlinkSync|renameSync|copyFileSync)\s*\(/,
  allow: [SIMULATED],
};

/**
 * Bans the import, not just the write, because the write is the easy half.
 *
 * A module that has imported the filesystem has already decided it might use
 * it, and the diff that turns a read into a write is one line that will not
 * look like a contract change. Refusing the import means the decision surfaces
 * where it can be argued about.
 *
 * raw: true because the module specifier is a string literal, and the default
 * stripper removes string contents before matching - a rule about a literal
 * that forgets this can never fire. Four rules were silently inert for exactly
 * that reason; scanner.test.ts now feeds each rule the spellings somebody would
 * actually write.
 */
export const FS_IMPORT_RULE: Rule = {
  name: "fs-import",
  raw: true,
  pattern: /from\s*["']node:fs["']|from\s*["']fs["']|require\(\s*["'](node:)?fs["']/,
  allow: [SIMULATED],
};

/**
 * Every spelling, because one of them is always the one that gets used.
 *
 * A node states its own address; the platform never needs to learn where a
 * reader is connecting from, and reading it once would put a location next to a
 * subject in the one place nothing is supposed to hold either - contract 2.
 *
 * The list covers header names, proxy variants, and the socket property,
 * because these arrive under different names depending on where a deployment
 * sits. scanner.test.ts feeds this rule six spellings and asserts it does NOT
 * fire on a comment saying the platform must not do it - a guard that flags
 * prose gets silenced rather than heeded.
 */
export const CLIENT_IP_RULE: Rule = {
  name: "client-ip",
  raw: true,
  pattern:
    /x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip|fastly-client-ip|\bremoteAddress\b|\b(request|req)\.ip\b|\bgeolocation\b/i,
};

export const NO_LOGGING_RULES: Rule[] = [
  { name: "console-call", pattern: /\bconsole\s*\.\s*\w+\s*\(/ },
  {
    name: "logger-call",
    pattern:
      /\b(logger|log|pino|winston|bunyan)\s*\.\s*(log|info|warn|error|debug|trace)\s*\(/,
  },
];

export const TELEMETRY_RULE: Rule = {
  name: "telemetry-endpoint",
  raw: true,
  pattern:
    /sentry\.io|ingest\.sentry|posthog\.com|\bmixpanel\b|segment\.(io|com)|amplitude\.com|google-analytics\.com|googletagmanager|datadoghq|\/collect\b|\bbeacon\b/i,
};

/**
 * Finds the idiom this codebase actually writes, not the idea of global state.
 *
 * Process state is where a user table would appear first, because it does not
 * look like storage: a Map at module scope is one line, survives every request,
 * and no reviewer reads it as a database. The pattern therefore matches
 * module-scope collections and the global-assignment idiom used here, and
 * deliberately spares a scratch collection inside a function and a frozen
 * lookup table - both are common and neither outlives a call.
 *
 * The point of catching it is not to forbid it. It is to force every instance
 * into PERMITTED_GLOBAL_STATE with a written reason, so the set of things this
 * process remembers is enumerated rather than discovered.
 */
export const MUTABLE_GLOBAL_RULE: Rule = {
  name: "mutable-global",
  pattern:
    /\b(globalThis|global)\b[^=\n]*\bas\b|\?\?=\s*new\s+(Map|Set|WeakMap|WeakSet)\b|^(export\s+)?(const|let|var)\s+\w+\s*(:(?!\s*Readonly(Set|Map)\b)[^=]+)?=\s*new\s+(Map|Set|WeakMap|WeakSet)\b/,
};

/**
 * A hosted store is a database that happens to be reached by fetch.
 *
 * The filesystem rules do not see it and the dependency scan does not either,
 * because a REST-shaped key-value store needs no client library at all - a URL
 * and a fetch is the whole integration. That makes it the cheapest way to
 * violate contract 2 without any of the other guards noticing.
 *
 * raw: true for the same reason as the import rule: these are string literals.
 */
export const REMOTE_STORE_RULE: Rule = {
  name: "remote-store",
  raw: true,
  pattern:
    /upstash\.io|supabase\.co|firebaseio\.com|firestore\.googleapis|\.rds\.amazonaws|documents\.azure\.com|blob\.vercel-storage\.com|\.convex\.cloud|planetscale|neon\.tech|turso\.io|mongodb(\+srv)?:\/\/|postgres(ql)?:\/\/|mysql:\/\/|redis(s)?:\/\//i,
};
