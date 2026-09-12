import { createHmac, timingSafeEqual } from "node:crypto";

import {
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";

import type { Tier } from "@/lib/access";


export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export const ISSUER = "cephroom";
export const ACCESS_AUDIENCE = "cephroom:access";
export const REFRESH_AUDIENCE = "cephroom:refresh";
export const SERVE_AUDIENCE = "cephroom:serve";

export type Scope =
  | "read:public"
  | "read:member"
  | "read:lab"
  | "write:propose"
  | "serve:node";

/**
 * What a key says.
 *
 * A pseudonymous subject, a tier, and what that tier permits. Nothing
 * descriptive, because a key is presented to parties the platform does not
 * control — a contributor's node sees one on every read — and anything in it
 * is something they learn.
 *
 * It carried two more fields until recently. The Google display name, which
 * meant reading a column told a stranger your real name; and the Stripe
 * customer id, which was a cache of Stripe's own records keyed by identity,
 * in a credential, which is the fourth of the places Contract 1 says the
 * platform does not mirror them. Both are gone and neither is re-derivable
 * from what is left, which is the point.
 */
export interface AccessKey {
  sub: string | null;
  tier: Tier;
  scp: Scope[];
  iat: number;
  exp: number;
}

export interface RefreshKey {
  sub: string;
  iat: number;
  exp: number;
}

export function scopesForTier(tier: Tier): Scope[] {
  const scopes: Scope[] = ["read:public"];
  if (tier === "member" || tier === "lab") {
    scopes.push("read:member", "write:propose");
  }
  if (tier === "lab") scopes.push("read:lab");
  return scopes;
}


export function deriveSubject(provider: string, accountId: string): string {
  const secret = requireEnv("AUTH_SUBJECT_SECRET");
  const digest = createHmac("sha256", secret)
    .update(`${provider}:${accountId}`)
    .digest("base64url");
  return `s_${digest.slice(0, 27)}`;
}

/**
 * The subject one contributor sees for one reader.
 *
 * The reader's real subject is a global identifier, and handing the same one
 * to every node made it a join key: two contributors comparing their logs
 * could reconstruct a reader's history across the whole network, and a
 * node's proposal list handed the same identifier to other readers. The
 * platform held no activity record and had distributed the means to build one.
 *
 * Derived from both halves under the server secret, so it is:
 *
 *   - stable for this pairing — the contributor recognises a returning
 *     reader, attributes a proposal, and enforces a per-person flood limit;
 *   - useless anywhere else — no other contributor can join on it, and it
 *     cannot be reversed to the reader without the secret;
 *   - visibly not a platform subject, hence the `n_` prefix, so one appearing
 *     where a real subject belongs is a noticeable wrong rather than a quiet
 *     one.
 *
 * The domain tag keeps this from colliding with `deriveSubject`, which HMACs
 * under the same secret over a different tuple.
 */
export function nodeScopedSubject(
  readerSub: string,
  contributorSub: string,
): string {
  const secret = requireEnv("AUTH_SUBJECT_SECRET");
  const digest = createHmac("sha256", secret)
    .update(`node-scope:${contributorSub}:${readerSub}`)
    .digest("base64url");
  return `n_${digest.slice(0, 27)}`;
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}


let privateKey: CryptoKey | null = null;
let publicKey: CryptoKey | null = null;

async function signingKey(): Promise<CryptoKey> {
  privateKey ??= (await importPKCS8(
    decodePem(requireEnv("CEPHROOM_SIGNING_KEY")),
    "EdDSA",
  )) as CryptoKey;
  return privateKey;
}

export async function verificationKey(): Promise<CryptoKey> {
  publicKey ??= (await importSPKI(
    decodePem(requireEnv("CEPHROOM_PUBLIC_KEY")),
    "EdDSA",
  )) as CryptoKey;
  return publicKey;
}

export function publicKeyPem(): string {
  return decodePem(requireEnv("CEPHROOM_PUBLIC_KEY"));
}

export async function mintAccessKey(input: {
  sub: string;
  tier: Tier;
}): Promise<string> {
  return new SignJWT({
    tier: input.tier,
    scp: scopesForTier(input.tier),
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    .setSubject(input.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(await signingKey());
}

export const NODE_KEY_TTL_SECONDS = 120;

/**
 * The key a reader's browser presents to one contributor's node.
 *
 * `audience` is the contributor being visited, and it does two things. It
 * scopes the subject, so this contributor sees a pseudonym nobody else can
 * join on. And it is stamped into the key as `nod`, so the key is refused
 * anywhere else — without that, a second node could accept a key minted for
 * the first, read the pseudonym the first would have seen, and the two could
 * correlate again through the back door.
 */
export async function mintNodeKey(input: {
  sub: string;
  tier: Tier;
  audience: string;
  /**
   * Seconds left on the session key this is derived from.
   *
   * Required, not optional: a caller that forgot it would silently restore
   * the behaviour this closes. A node key used to live a flat two minutes
   * regardless, so one minted in the last second of a session carried the old
   * tier for a further two — making the site's promise that "a cancellation
   * reaches you within fifteen minutes" wrong by two minutes, and letting a
   * derived credential outlive the one that authorised it.
   */
  sessionSecondsLeft: number;
}): Promise<string> {
  const life = Math.max(
    0,
    Math.min(NODE_KEY_TTL_SECONDS, Math.floor(input.sessionSecondsLeft)),
  );

  return new SignJWT({
    tier: input.tier,
    scp: scopesForTier(input.tier),
    nod: input.audience,
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    .setSubject(nodeScopedSubject(input.sub, input.audience))
    .setIssuedAt()
    // A zero here mints an already-expired key, which is the right answer:
    // the reader gets the public preview, exactly as they would with no key.
    .setExpirationTime(`${life}s`)
    .sign(await signingKey());
}

export async function mintAnonymousKey(input: {
  tier: Tier;
}): Promise<string> {
  const readOnly = scopesForTier(input.tier).filter(
    (scope) => scope !== "write:propose",
  );

  return new SignJWT({ tier: input.tier, scp: readOnly, anon: true })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    // No .setSubject(). A JWT with no `sub` claim is exactly what this is.
    .setIssuedAt()
    .setExpirationTime(`${NODE_KEY_TTL_SECONDS}s`)
    .sign(await signingKey());
}

export const SERVE_KEY_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SERVE_KEY_TTL_DAYS = 30;

export async function mintServeKey(input: {
  sub: string;
  tier: Tier;
}): Promise<string> {
  return new SignJWT({
    tier: input.tier,
    // No read scopes. The only capability a serve key carries is announcing a
    // node under its subject; it is not a reader session and must never be
    // usable as one. The tier rides along only so the account page can show
    // whose key it is.
    scp: ["serve:node"] satisfies Scope[],
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(SERVE_AUDIENCE)
    .setSubject(input.sub)
    .setIssuedAt()
    .setExpirationTime(`${SERVE_KEY_TTL_SECONDS}s`)
    .sign(await signingKey());
}

export async function mintRefreshKey(input: { sub: string }): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(REFRESH_AUDIENCE)
    .setSubject(input.sub)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TTL_SECONDS}s`)
    .sign(await signingKey());
}

export async function verifyAccessKey(
  token: string,
  options: { audience?: string } = {},
): Promise<AccessKey | null> {
  const payload = await verify(token, ACCESS_AUDIENCE);
  // A subject-less key is valid and anonymous — not invalid. What is not
  // acceptable is a key with neither a subject nor the anonymous marker, which
  // would be a malformed key rather than a deliberate one.
  if (!payload || (!payload.sub && payload.anon !== true)) return null;

  const tier = payload.tier as Tier | undefined;
  if (tier !== "reader" && tier !== "member" && tier !== "lab") return null;

  // A key bound to a contributor is only a key at that contributor. An
  // anonymous key carries no binding and travels anywhere, which costs
  // nothing because it names nobody.
  const boundTo = payload.nod as string | undefined;
  if (payload.anon !== true) {
    if (options.audience) {
      if (boundTo !== options.audience) return null;
    } else if (boundTo) {
      // A node-bound key presented where a plain session key is required —
      // a node replaying a reader's key back at the platform.
      return null;
    }
  }

  return {
    sub: payload.sub ?? null,
    tier,
    scp: (payload.scp as Scope[]) ?? [],
    iat: payload.iat!,
    exp: payload.exp!,
  };
}

export async function verifyServeKey(
  token: string,
): Promise<{ sub: string } | null> {
  const payload = await verify(token, SERVE_AUDIENCE);
  if (!payload?.sub) return null;
  return { sub: payload.sub };
}

export async function verifyRefreshKey(
  token: string,
): Promise<RefreshKey | null> {
  const payload = await verify(token, REFRESH_AUDIENCE);
  if (!payload?.sub) return null;
  return { sub: payload.sub, iat: payload.iat!, exp: payload.exp! };
}

async function verify(
  token: string,
  audience: string,
): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, await verificationKey(), {
      issuer: ISSUER,
      audience,
    });
    return payload;
  } catch {
    // An expired, forged, or wrong-audience key is simply not a key. There is
    // no blocklist to consult and no record to write about the attempt.
    return null;
  }
}

export function hasScope(key: AccessKey | null, scope: Scope): boolean {
  return Boolean(key?.scp.includes(scope));
}

function decodePem(value: string): string {
  // Keys are supplied base64-encoded so they survive a single-line env var.
  return value.includes("BEGIN")
    ? value.replace(/\\n/g, "\n")
    : Buffer.from(value, "base64").toString("utf8");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Run "npm run keys:generate" and put the output in .env.local.`,
    );
  }
  return value;
}
