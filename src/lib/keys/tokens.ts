import { createHmac, timingSafeEqual } from "node:crypto";

import {
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";

import type { DiscoveryTier } from "@/lib/access";
import { FREE_SERVING_CAPACITY, SERVING_CAPACITY } from "@/lib/stripe/plans";


export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export const ISSUER = "cephroom";
export const ACCESS_AUDIENCE = "cephroom:access";
export const REFRESH_AUDIENCE = "cephroom:refresh";
export const SERVE_AUDIENCE = "cephroom:serve";

/**
 * What a key permits.
 *
 * The read scopes are gone. There is nothing to grant: a column is served
 * whole to whoever asks, and a contributor's node has no tier to measure a
 * reader against. What remains is the two things a key still has to say —
 * that its holder may be attributed for something they write, and that they
 * may announce a node under their subject.
 */
export type Scope = "write:propose" | "serve:node";

export const SCOPES: readonly Scope[] = ["write:propose", "serve:node"] as const;

/**
 * What a key says.
 *
 * A pseudonymous subject and what it permits. Nothing descriptive, because a
 * key is presented to parties the platform does not control, and anything in
 * it is something they learn.
 *
 * It has lost three fields. The Google display name, which meant reading a
 * column told a stranger your real name; the Stripe customer id, which was a
 * cache of Stripe's records inside a credential; and now the tier, because a
 * consumer's subscription is about the platform's discovery and is nobody
 * else's business. A contributor's node sees a subject and a scope, and there
 * is nothing else there to read.
 */
export interface AccessKey {
  sub: string | null;
  scp: Scope[];
  /** Present only on a session key, never on one handed to a node. */
  discovery?: DiscoveryTier;
  iat: number;
  exp: number;
}

export interface RefreshKey {
  sub: string;
  iat: number;
  exp: number;
}

/**
 * What any signed-in party may do.
 *
 * Proposing is free. It always should have been: a proposal is work the
 * reader does *for* the contributor, and charging for the privilege of
 * offering it was backwards. What it needs is attribution, not payment —
 * somebody for the contributor to answer.
 */
export function scopesForSignedIn(): Scope[] {
  return ["write:propose"];
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
  /** The consumer's own discovery plan. Never leaves the platform. */
  discovery: DiscoveryTier;
}): Promise<string> {
  return new SignJWT({
    scp: scopesForSignedIn(),
    discovery: input.discovery,
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
  audience: string;
  /**
   * Seconds left on the session key this is derived from. Required, not
   * optional: a caller that forgot it would silently restore a derived
   * credential outliving the one that authorised it.
   */
  sessionSecondsLeft: number;
}): Promise<string> {
  const life = Math.max(
    0,
    Math.min(NODE_KEY_TTL_SECONDS, Math.floor(input.sessionSecondsLeft)),
  );

  // No tier, and no read scope. A contributor's node is handed a pseudonym
  // scoped to them and permission to be attributed for a proposal, and that
  // is the whole of it. There is nothing here for a paywall to read because
  // there is no paywall to read it.
  return new SignJWT({ scp: scopesForSignedIn(), nod: input.audience })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    .setSubject(nodeScopedSubject(input.sub, input.audience))
    .setIssuedAt()
    .setExpirationTime(`${life}s`)
    .sign(await signingKey());
}

/**
 * A key that carries a discovery plan and no subject.
 *
 * Layer 1 severed who-paid from who-reads. Reading is no longer gated, so
 * what it severs now is who-paid from *who-searches* — a subscriber's queries
 * would otherwise reach the platform with their cookie attached, and querying
 * is the one activity the platform can still see. The tokens are more useful
 * here than they were against a paywall, not less: a paywall was one bit
 * about a person, and a search history is a research programme.
 */
export async function mintAnonymousKey(input: {
  discovery: DiscoveryTier;
}): Promise<string> {
  return new SignJWT({ discovery: input.discovery, scp: [], anon: true })
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
  /** How many items this contributor's plan lets them announce at once. */
  capacity?: number;
}): Promise<string> {
  return new SignJWT({
    // The only capability a serve key carries is announcing a node under its
    // subject; it is not a reader session and must never be usable as one.
    scp: ["serve:node"] satisfies Scope[],
    // Capacity rather than a plan name, because capacity is the thing the
    // registry actually applies. A contributor on the free plan has one too.
    cap: input.capacity ?? FREE_SERVING_CAPACITY,
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
    scp: (payload.scp as Scope[]) ?? [],
    discovery: payload.discovery as DiscoveryTier | undefined,
    iat: payload.iat!,
    exp: payload.exp!,
  };
}

export async function verifyServeKey(
  token: string,
): Promise<{ sub: string; capacity: number } | null> {
  const payload = await verify(token, SERVE_AUDIENCE);
  if (!payload?.sub) return null;
  const capacity = payload.cap;
  return {
    sub: payload.sub,
    capacity:
      typeof capacity === "number" && Number.isSafeInteger(capacity) && capacity > 0
        ? Math.min(capacity, SERVING_CAPACITY.stacks)
        : FREE_SERVING_CAPACITY,
  };
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
