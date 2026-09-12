import type { Rule } from "./scan";


export const SIMULATED = "simulated-counterparties/";

export const FS_WRITE_RULE: Rule = {
  name: "fs-write",
  pattern:
    /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|mkdirSync|mkdir|rmSync|unlinkSync|renameSync|copyFileSync)\s*\(/,
  allow: [SIMULATED],
};

export const FS_IMPORT_RULE: Rule = {
  name: "fs-import",
  raw: true,
  pattern: /from\s*["']node:fs["']|from\s*["']fs["']|require\(\s*["'](node:)?fs["']/,
  allow: [SIMULATED],
};

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

export const MUTABLE_GLOBAL_RULE: Rule = {
  name: "mutable-global",
  pattern:
    /\b(globalThis|global)\b[^=\n]*\bas\b|\?\?=\s*new\s+(Map|Set|WeakMap|WeakSet)\b|^(export\s+)?(const|let|var)\s+\w+\s*(:(?!\s*Readonly(Set|Map)\b)[^=]+)?=\s*new\s+(Map|Set|WeakMap|WeakSet)\b/,
};

export const REMOTE_STORE_RULE: Rule = {
  name: "remote-store",
  raw: true,
  pattern:
    /upstash\.io|supabase\.co|firebaseio\.com|firestore\.googleapis|\.rds\.amazonaws|documents\.azure\.com|blob\.vercel-storage\.com|\.convex\.cloud|planetscale|neon\.tech|turso\.io|mongodb(\+srv)?:\/\/|postgres(ql)?:\/\/|mysql:\/\/|redis(s)?:\/\//i,
};
