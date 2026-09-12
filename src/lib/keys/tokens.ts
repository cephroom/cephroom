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


/**
 * Contract 3 has no revocation, so expiry is the whole of it.
 *
 * Revoking one key needs a list of keys that are no longer good, and a list is
 * state about people — contract 2. So there is no blocklist, and a stolen key
 * stays good until it runs out. These two numbers are therefore the entire
 * blast radius of a theft: fifteen minutes of reading, seven days of renewal.
 *
 * Lengthening either widens that window with nothing to close it. The only
 * remedy this design has for a compromised key is rotating the signing key,
 * which signs every reader out at once, so it is not a remedy anyone will reach
 * for over a single incident.
 */
export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export const ISSUER = "cephroom";
export const ACCESS_AUDIENCE = "cephroom:access";
export const REFRESH_AUDIENCE = "cephroom:refresh";
export const SERVE_AUDIENCE = "cephroom:serve";

/**
 * There is deliberately no `read:` scope, and adding one would be the single
 * change that unpicks contract 1.
 *
 * A node serves a column whole to whoever asks. It has no tier to check because
 * nothing in a reader's key describes what they have paid for, and the moment a
 * scope exists that says otherwise, a contributor's node acquires a gate and
 * the platform acquires a reason to care who is reading. That is a publishing
 * SaaS.
 *
 * `a-key-unlocks-nothing.test.ts` asserts this list contains nothing beginning
 * `read:`, and that no component renders an access badge to go with one.
 */
export type Scope = "write:propose" | "serve:node";

export const SCOPES: readonly Scope[] = ["write:propose", "serve:node"] as const;

export interface AccessKey {
  sub: string | null;
  scp: Scope[];
  discovery?: DiscoveryTier;
  iat: number;
  exp: number;
}

export interface RefreshKey {
  sub: string;
  iat: number;
  exp: number;
}

export function scopesForSignedIn(): Scope[] {
  return ["write:propose"];
}


/**
 * The one place an identity becomes an identifier, and it is one-way by
 * construction — contract 2.
 *
 * The provider account id arrives at sign-in, is HMAC'd here under a server
 * secret, and is dropped. Nothing stores the input and nothing can run this
 * backwards, so the subject that rides along afterwards is not reversible to an
 * account. `AUTH_SUBJECT_SECRET` is effectively permanent: changing it gives
 * every returning reader a new identity and orphans their Stripe customer,
 * which `rename-continuity.test.ts` exists to survive at the metadata layer but
 * cannot rescue here.
 *
 * `identity-surface.test.ts` fails if `createHmac` appears in any other module.
 */
export function deriveSubject(provider: string, accountId: string): string {
  const secret = requireEnv("AUTH_SUBJECT_SECRET");
  const digest = createHmac("sha256", secret)
    .update(`${provider}:${accountId}`)
    .digest("base64url");
  return `s_${digest.slice(0, 27)}`;
}

/**
 * Why a reader does not have one identity — contract 2, and the hostile-insider
 * half of it.
 *
 * A contributor needs to tell their own readers apart: to answer a proposal, and
 * to stop one person filing twenty. A stable subject would do that and would
 * also let two contributors compare notes and reconstruct one person's reading
 * across the network, which is the correlation this platform claims to prevent.
 *
 * Scoping the pseudonym to the contributor gives the first without the second.
 * The same reader appears to two contributors as two unrelated strangers, and
 * neither can recover the platform subject, because the HMAC secret is not
 * theirs. `what-each-side-learns.test.ts` asserts both halves: that a
 * contributor CAN recognise a returning reader, and CANNOT find them next door.
 *
 * The `n_` prefix is load-bearing, not cosmetic. `node/proposals.ts` refuses to
 * store anything else, because a platform subject written to a contributor's
 * disk cannot be withdrawn afterwards.
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
 * Capped by whatever is left of the session it was derived from.
 *
 * This key is handed to a machine the platform does not control, so its life is
 * the length of time a contributor can replay it. Letting it outlive the
 * session would mean a reader who signed out an hour ago is still presenting a
 * live credential at somebody else's node, and neither party could tell.
 *
 * `sessionSecondsLeft` is required rather than optional so that a caller cannot
 * quietly forget it; when the session is already gone this mints an
 * already-dead key rather than a fresh two-minute one.
 * `derived-keys-do-not-outlive-the-session.test.ts` holds all of that.
 */
export async function mintNodeKey(input: {
  sub: string;
  audience: string;
  sessionSecondsLeft: number;
}): Promise<string> {
  const life = Math.max(
    0,
    Math.min(NODE_KEY_TTL_SECONDS, Math.floor(input.sessionSecondsLeft)),
  );

  return new SignJWT({ scp: scopesForSignedIn(), nod: input.audience })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    .setSubject(nodeScopedSubject(input.sub, input.audience))
    .setIssuedAt()
    .setExpirationTime(`${life}s`)
    .sign(await signingKey());
}

export async function mintAnonymousKey(input: {
  discovery: DiscoveryTier;
}): Promise<string> {
  return new SignJWT({ discovery: input.discovery, scp: [], anon: true })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${NODE_KEY_TTL_SECONDS}s`)
    .sign(await signingKey());
}

export const SERVE_KEY_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SERVE_KEY_TTL_DAYS = 30;

export async function mintServeKey(input: {
  sub: string;
  capacity?: number;
}): Promise<string> {
  return new SignJWT({
    scp: ["serve:node"] satisfies Scope[],
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

/**
 * The `nod` check runs in both directions on purpose.
 *
 * A key minted for one contributor must not verify at another — otherwise the
 * scoping above buys nothing, because a contributor could replay what they were
 * given next door and watch it work. And a contributor-bound key must not
 * verify where a plain session key is required, or a node could take the
 * credential a reader handed it and act as that reader on the platform itself.
 *
 * Anonymous keys are exempt from both: they name nobody, so there is nothing to
 * bind and nothing to steal. `readers-are-not-correlatable.test.ts` covers each
 * case, including the one that looks redundant.
 *
 * Expiry is checked here by `jwtVerify`, from the signature — never decrypted,
 * never looked up. That is what lets a contributor's node make the same
 * decision offline with only the published public key (see `node/verify.ts`).
 */
export async function verifyAccessKey(
  token: string,
  options: { audience?: string } = {},
): Promise<AccessKey | null> {
  const payload = await verify(token, ACCESS_AUDIENCE);
  if (!payload || (!payload.sub && payload.anon !== true)) return null;

  const boundTo = payload.nod as string | undefined;
  if (payload.anon !== true) {
    if (options.audience) {
      if (boundTo !== options.audience) return null;
    } else if (boundTo) {
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

/**
 * Capacity is clamped on the way in, not trusted from the claim.
 *
 * `cap` is a number the platform signed, but this key lives for thirty days on
 * a contributor's machine and the plan behind it can lapse in that time. The
 * clamp bounds the damage of a stale or malformed value to the largest capacity
 * anyone could legitimately buy, and a missing or nonsensical one falls back to
 * the free tier rather than to zero — contract 6's neighbour: serving is free,
 * so a bad key must degrade to "free plan", never to "cannot publish".
 */
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
    return null;
  }
}

export function hasScope(key: AccessKey | null, scope: Scope): boolean {
  return Boolean(key?.scp.includes(scope));
}

function decodePem(value: string): string {
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
