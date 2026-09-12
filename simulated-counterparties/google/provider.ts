
/**
 * A stand-in for Google's OAuth endpoints, run locally.
 *
 * This lives with the other simulated counterparty rather than in `src/`,
 * which is not tidiness — it is the boundary. AGENTS.md says counterparties
 * are mocked, never our own code, and that the directory name *is* the
 * enforcement. While this file sat in `src/lib/auth/`, the platform's source
 * contained a list of people with email addresses, and the contract test that
 * guards identity had to carry four separate exemptions to allow it.
 *
 * Google holds names and addresses because an identity provider must. That is
 * a fact about Google, so it belongs on Google's side of the line, and the
 * platform's side now has no email address in it at all.
 *
 * Everything here is development-only and gated on AUTH_DEV_OAUTH=1.
 */
export const DEV_OAUTH_CLIENT_ID = "cephroom-local";
export const DEV_OAUTH_CLIENT_SECRET = "cephroom-local-secret";

export function isDevOAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_OAUTH === "1"
  );
}

export interface DevPersona {
  sub: string;
  name: string;
  email: string;
  picture: string | null;
  mimics: "google" | "github";
  login?: string;
}

export const DEV_PERSONAS: DevPersona[] = [
  {
    sub: "dev-google-1",
    name: "Rosalind Hale",
    email: "rosalind.hale@example.com",
    picture: null,
    mimics: "google",
  },
  {
    sub: "dev-github-1",
    name: "Kenji Abara",
    email: "kenji.abara@example.com",
    picture: null,
    mimics: "github",
    login: "kabara",
  },
];

interface IssuedCode {
  persona: DevPersona;
  redirectUri: string;
  expiresAt: number;
}

interface IssuedToken {
  persona: DevPersona;
  expiresAt: number;
}

// Module-level state is fine here: this exists only in a single dev process.
const globalForCodes = globalThis as unknown as {
  __devOAuthCodes?: Map<string, IssuedCode>;
  __devOAuthTokens?: Map<string, IssuedToken>;
};

export const issuedCodes = (globalForCodes.__devOAuthCodes ??= new Map());
export const issuedTokens = (globalForCodes.__devOAuthTokens ??= new Map());

export const DEV_CODE_TTL_MS = 5 * 60_000;

/**
 * How long a dev access token answers for.
 *
 * It matches the `expires_in` the token endpoint already advertised, which
 * previously described a lifetime nothing enforced: the token map was written
 * on every exchange and never read for expiry, never pruned and never
 * deleted. Left running, a development process accumulated one
 * token-to-persona entry per sign-in for as long as it was up — an unbounded
 * map from a bearer credential to a name and an email address, inside the
 * platform process.
 *
 * It is the counterparty's state rather than the platform's, and it is
 * development-only, both of which make it permitted. Neither makes it
 * exempt from being bounded, so it expires and prunes like everything else
 * here does.
 */
export const DEV_TOKEN_TTL_MS = 60 * 60_000;

export function issueCode(
  persona: DevPersona,
  redirectUri: string,
  now: number = Date.now(),
): string {
  const code = `devcode_${crypto.randomUUID()}`;
  prune(issuedCodes, now);
  issuedCodes.set(code, {
    persona,
    redirectUri,
    expiresAt: now + DEV_CODE_TTL_MS,
  });
  return code;
}

export function redeemCode(code: string, now: number = Date.now()): DevPersona | null {
  const entry = issuedCodes.get(code);
  if (!entry) return null;
  issuedCodes.delete(code);
  if (entry.expiresAt < now) return null;
  return entry.persona;
}

export function issueToken(persona: DevPersona, now: number = Date.now()): string {
  const token = `devtok_${crypto.randomUUID()}`;
  prune(issuedTokens, now);
  issuedTokens.set(token, { persona, expiresAt: now + DEV_TOKEN_TTL_MS });
  return token;
}

/**
 * The persona behind a bearer token, or null.
 *
 * Reading goes through here rather than through `issuedTokens.get` so that
 * expiry is applied at the one place a token is exchanged for a name. A
 * caller reaching into the map directly would resurrect the old behaviour
 * without touching this file.
 */
export function personaForToken(
  token: string,
  now: number = Date.now(),
): DevPersona | null {
  prune(issuedTokens, now);
  const entry = issuedTokens.get(token);
  if (!entry) return null;
  if (entry.expiresAt < now) {
    issuedTokens.delete(token);
    return null;
  }
  return entry.persona;
}

export function issuedTokenCount(): number {
  return issuedTokens.size;
}

/** Lazy sweep, like the presence registry: no timer, no separate lifecycle. */
function prune(entries: Map<string, { expiresAt: number }>, now: number): void {
  for (const [key, entry] of entries) {
    if (entry.expiresAt < now) entries.delete(key);
  }
}


function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
}

/**
 * The consent screen.
 *
 * Rendered here rather than in the route so that the personas — and their
 * email addresses — never appear in the platform's own source. The route is a
 * transport shim; this is the counterparty.
 */
export function renderConsentScreen(input: {
  pathname: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
}): string {
  const rows = DEV_PERSONAS.map((persona) => {
    const href = `${input.pathname}?${new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      state: input.state,
      persona: persona.sub,
    })}`;
    return `<a class="row" href="${escapeHtml(href)}">
      <span class="avatar">${escapeHtml(persona.name.charAt(0))}</span>
      <span>
        <strong>${escapeHtml(persona.name)}</strong>
        <em>${escapeHtml(persona.email)}</em>
      </span>
      <span class="badge">${escapeHtml(persona.mimics)}</span>
    </a>`;
  }).join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Local dev SSO</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; min-height: 100vh;
         display: grid; place-items: center; background: #eceae4; color: #16181a; }
  .card { width: min(26rem, calc(100vw - 2rem)); background: #fff; border-radius: 12px;
          padding: 1.75rem; box-shadow: 0 12px 40px rgba(0,0,0,.12); }
  h1 { font-size: 1.05rem; margin: 0 0 .25rem; }
  p.sub { margin: 0 0 1.25rem; color: #5b6067; font-size: .85rem; }
  .row { display: flex; align-items: center; gap: .8rem; padding: .7rem .8rem;
         border: 1px solid #e2ded2; border-radius: 8px; text-decoration: none;
         color: inherit; margin-bottom: .6rem; }
  .row:hover { border-color: #0f5c4a; background: #f4faf7; }
  .avatar { width: 34px; height: 34px; border-radius: 50%; background: #0f5c4a;
            color: #fff; display: grid; place-items: center; font-weight: 600; }
  strong { display: block; font-size: .9rem; }
  em { font-style: normal; color: #5b6067; font-size: .78rem; }
  .row > span:nth-child(2) { flex: 1; }
  .badge { font-size: .68rem; text-transform: uppercase; letter-spacing: .06em;
           color: #5b6067; border: 1px solid #e2ded2; border-radius: 999px; padding: .15rem .5rem; }
  .note { margin-top: 1.1rem; font-size: .75rem; color: #8b9099; }
</style></head>
<body><div class="card">
  <h1>Choose a test account</h1>
  <p class="sub">Local OAuth provider — development only. Cephroom is requesting ${escapeHtml(input.scope)} — and note what is not in that list.</p>
  ${rows}
  <p class="note">This endpoint exists so the OAuth code path can be exercised without Google or GitHub credentials. It is disabled unless AUTH_DEV_OAUTH=1.</p>
</div></body></html>`;
  return html;
}
