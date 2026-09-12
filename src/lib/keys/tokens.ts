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


export function deriveSubject(provider: string, accountId: string): string {
  const secret = requireEnv("AUTH_SUBJECT_SECRET");
  const digest = createHmac("sha256", secret)
    .update(`${provider}:${accountId}`)
    .digest("base64url");
  return `s_${digest.slice(0, 27)}`;
}

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
