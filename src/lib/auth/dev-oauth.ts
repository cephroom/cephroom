
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

// Module-level state is fine here: this exists only in a single dev process.
const globalForCodes = globalThis as unknown as {
  __devOAuthCodes?: Map<string, IssuedCode>;
  __devOAuthTokens?: Map<string, DevPersona>;
};

export const issuedCodes = (globalForCodes.__devOAuthCodes ??= new Map());
export const issuedTokens = (globalForCodes.__devOAuthTokens ??= new Map());

export function issueCode(persona: DevPersona, redirectUri: string): string {
  const code = `devcode_${crypto.randomUUID()}`;
  issuedCodes.set(code, {
    persona,
    redirectUri,
    expiresAt: Date.now() + 5 * 60_000,
  });
  return code;
}

export function redeemCode(code: string): DevPersona | null {
  const entry = issuedCodes.get(code);
  if (!entry) return null;
  issuedCodes.delete(code);
  if (entry.expiresAt < Date.now()) return null;
  return entry.persona;
}

export function issueToken(persona: DevPersona): string {
  const token = `devtok_${crypto.randomUUID()}`;
  issuedTokens.set(token, persona);
  return token;
}
