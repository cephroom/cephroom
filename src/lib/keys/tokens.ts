import { createHmac, timingSafeEqual } from "node:crypto";

import {
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";

import type { Tier } from "@/lib/access";

/**
 * Capability keys.
 *
 * Contract 1: the platform persists nothing about users. There is no session
 * table, so a key *is* the session — a signed statement of who you are and
 * what you may do, which the platform verifies by signature rather than by
 * looking anything up.
 *
 * Signing is Ed25519 rather than an HMAC because a contributor's node has to
 * verify a reader's key before serving member-only content, and it must be
 * able to do that with a public key alone. A shared secret would let every
 * node mint keys.
 *
 * See docs/CONTRACTS.md for the revocation tradeoff, which is real and
 * unmitigated: these keys cannot be revoked, only outlived.
 */

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export const ISSUER = "bindery";
export const ACCESS_AUDIENCE = "bindery:access";
export const REFRESH_AUDIENCE = "bindery:refresh";

export type Scope =
  | "read:public"
  | "read:member"
  | "read:lab"
  | "write:propose"
  | "serve:node";

export interface AccessKey {
  /** Pseudonymous subject. An HMAC of the provider account id. */
  sub: string;
  tier: Tier;
  scp: Scope[];
  /** Stripe customer id, when the subject has one. */
  cus?: string;
  /** Display name the reader chose at the provider. Never stored by us. */
  name?: string;
  iat: number;
  exp: number;
}

export interface RefreshKey {
  sub: string;
  cus?: string;
  name?: string;
  iat: number;
  exp: number;
}

export function scopesForTier(tier: Tier): Scope[] {
  const scopes: Scope[] = ["read:public"];
  if (tier === "member" || tier === "lab") {
    scopes.push("read:member", "write:propose");
  }
  if (tier === "lab") scopes.push("read:lab", "serve:node");
  return scopes;
}

/* ------------------------------------------------------------------ *
 * Pseudonymous subjects
 * ------------------------------------------------------------------ */

/**
 * Derives a stable subject from a provider account id.
 *
 * Stable, so attribution survives signing out and back in. One-way, so a
 * token in the wild does not reveal which Google account it came from, and
 * neither would a leak of the platform — which has nothing to leak.
 */
export function deriveSubject(provider: string, accountId: string): string {
  const secret = requireEnv("AUTH_SUBJECT_SECRET");
  const digest = createHmac("sha256", secret)
    .update(`${provider}:${accountId}`)
    .digest("base64url");
  return `s_${digest.slice(0, 27)}`;
}

/** Constant-time compare, for CSRF state and similar short opaque values. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/* ------------------------------------------------------------------ *
 * Signing and verification
 * ------------------------------------------------------------------ */

let privateKey: CryptoKey | null = null;
let publicKey: CryptoKey | null = null;

async function signingKey(): Promise<CryptoKey> {
  privateKey ??= (await importPKCS8(
    decodePem(requireEnv("BINDERY_SIGNING_KEY")),
    "EdDSA",
  )) as CryptoKey;
  return privateKey;
}

export async function verificationKey(): Promise<CryptoKey> {
  publicKey ??= (await importSPKI(
    decodePem(requireEnv("BINDERY_PUBLIC_KEY")),
    "EdDSA",
  )) as CryptoKey;
  return publicKey;
}

/** The public key, in the form a node fetches from /.well-known. */
export function publicKeyPem(): string {
  return decodePem(requireEnv("BINDERY_PUBLIC_KEY"));
}

export async function mintAccessKey(input: {
  sub: string;
  tier: Tier;
  cus?: string;
  name?: string;
}): Promise<string> {
  return new SignJWT({
    tier: input.tier,
    scp: scopesForTier(input.tier),
    ...(input.cus ? { cus: input.cus } : {}),
    ...(input.name ? { name: input.name } : {}),
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    .setSubject(input.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(await signingKey());
}

/**
 * A key for presenting to a node, minted per page view.
 *
 * The reader's own key is httpOnly, so the browser cannot read it to put in
 * an Authorization header. Rather than dropping the real key into the page,
 * this mints a separate one that lives for two minutes: long enough to fetch
 * a column, short enough that finding it in a page source is worth little.
 */
export const NODE_KEY_TTL_SECONDS = 120;

export async function mintNodeKey(input: {
  sub: string;
  tier: Tier;
  name?: string;
}): Promise<string> {
  return new SignJWT({
    tier: input.tier,
    scp: scopesForTier(input.tier),
    ...(input.name ? { name: input.name } : {}),
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    .setSubject(input.sub)
    .setIssuedAt()
    .setExpirationTime(`${NODE_KEY_TTL_SECONDS}s`)
    .sign(await signingKey());
}

export async function mintRefreshKey(input: {
  sub: string;
  cus?: string;
  name?: string;
}): Promise<string> {
  return new SignJWT({
    ...(input.cus ? { cus: input.cus } : {}),
    ...(input.name ? { name: input.name } : {}),
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(REFRESH_AUDIENCE)
    .setSubject(input.sub)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TTL_SECONDS}s`)
    .sign(await signingKey());
}

export async function verifyAccessKey(token: string): Promise<AccessKey | null> {
  const payload = await verify(token, ACCESS_AUDIENCE);
  if (!payload?.sub) return null;

  const tier = payload.tier as Tier | undefined;
  if (tier !== "reader" && tier !== "member" && tier !== "lab") return null;

  return {
    sub: payload.sub,
    tier,
    scp: (payload.scp as Scope[]) ?? [],
    cus: payload.cus as string | undefined,
    name: payload.name as string | undefined,
    iat: payload.iat!,
    exp: payload.exp!,
  };
}

export async function verifyRefreshKey(
  token: string,
): Promise<RefreshKey | null> {
  const payload = await verify(token, REFRESH_AUDIENCE);
  if (!payload?.sub) return null;
  return {
    sub: payload.sub,
    cus: payload.cus as string | undefined,
    name: payload.name as string | undefined,
    iat: payload.iat!,
    exp: payload.exp!,
  };
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
