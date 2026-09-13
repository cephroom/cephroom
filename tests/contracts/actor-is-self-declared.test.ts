import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decodeJwt } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "./scan";
import { asActor, DEFAULT_ACTOR } from "@/lib/actor";

const platform = generateKeyPairSync("ed25519");
const b64 = (pem: string) => Buffer.from(pem).toString("base64");
let tokens: typeof import("@/lib/keys/tokens");

beforeAll(async () => {
  process.env.CEPHROOM_SIGNING_KEY = b64(
    platform.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  );
  process.env.CEPHROOM_PUBLIC_KEY = b64(
    platform.publicKey.export({ type: "spki", format: "pem" }) as string,
  );
  process.env.AUTH_SUBJECT_SECRET = randomBytes(32).toString("hex");
  tokens = await import("@/lib/keys/tokens");
});

/**
 * The human/AI actor is a self-declaration, and these fix the four things that
 * keeps it honest - see @/lib/actor. It is bounded to two words, it round-trips
 * unchanged, it NEVER gates anything, and it is never presented as verified.
 */
describe("the actor is bounded to two words", () => {
  it("reads only 'ai' as ai; everything else is a person", () => {
    expect(asActor("ai")).toBe("ai");
    expect(asActor("human")).toBe("human");
    expect(asActor("HUMAN")).toBe("human");
    expect(asActor("robot")).toBe("human");
    expect(asActor("")).toBe("human");
    expect(asActor(undefined)).toBe("human");
    expect(asActor(null)).toBe("human");
    expect(asActor({ toString: () => "ai" })).toBe("human");
    expect(DEFAULT_ACTOR).toBe("human");
  });

  it("cannot smuggle an arbitrary claim into a key", async () => {
    const claims = decodeJwt(
      await tokens.mintAccessKey({
        sub: "s_reader",
        discovery: "query",
        actor: "'; DROP" as never,
      }),
    );
    expect(claims.act).toBe("human");
  });
});

describe("the actor round-trips through the keys that carry it", () => {
  it("survives an access key mint and verify", async () => {
    const key = await tokens.mintAccessKey({ sub: "s_r", discovery: "query", actor: "ai" });
    expect((await tokens.verifyAccessKey(key))?.actor).toBe("ai");
  });

  it("survives a refresh key mint and verify", async () => {
    const key = await tokens.mintRefreshKey({ sub: "s_r", actor: "ai" });
    expect((await tokens.verifyRefreshKey(key))?.actor).toBe("ai");
  });

  it("defaults to human on a key minted without one (older keys included)", async () => {
    const key = await tokens.mintAccessKey({ sub: "s_r", discovery: "query" });
    expect((await tokens.verifyAccessKey(key))?.actor).toBe("human");
  });
});

describe("the actor never decides what anyone may do", () => {
  it("does not change the discovery a key carries", async () => {
    const asHuman = decodeJwt(
      await tokens.mintAccessKey({ sub: "s_r", discovery: "sweep", actor: "human" }),
    );
    const asAi = decodeJwt(
      await tokens.mintAccessKey({ sub: "s_r", discovery: "sweep", actor: "ai" }),
    );
    expect(asHuman.discovery).toBe("sweep");
    expect(asAi.discovery).toBe("sweep");
  });

  it("is not read by the modules that decide reach and entitlement (contract 3)", () => {
    // Authorization is a signature and a plan, never who you say you are. If any
    // of these started branching on the actor, an unverifiable self-claim would
    // have become a permission.
    for (const rel of [
      "src/lib/access.ts",
      "src/lib/stripe/entitlement.ts",
      "src/lib/signaling/fair-share.ts",
      "src/lib/tokens/issuance-gate.ts",
    ]) {
      const code = stripCommentsOnly(readFileSync(join(ROOT, rel), "utf8"));
      expect(code, `${rel} must not read the actor`).not.toMatch(/\bactor\b|["']act["']|@\/lib\/actor/);
    }
  });

  it("the token issue route gates on the plan, not the actor", () => {
    const code = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "app", "api", "tokens", "issue", "route.ts"), "utf8"),
    );
    expect(code).not.toMatch(/\bactor\b|@\/lib\/actor/);
  });
});

describe("the actor is never presented as verified", () => {
  const prose = (...p: string[]) =>
    readFileSync(join(ROOT, ...p), "utf8").replace(/\s+/g, " ");

  it("says on the sign-in page that nothing checks it", () => {
    const signin = prose("src", "app", "signin", "page.tsx");
    // The shared disclaimer, referenced by the page, carries the honesty.
    expect(signin).toMatch(/ACTOR_DISCLAIMER/);
  });

  it("keeps the disclaimer honest at its source", () => {
    const actor = prose("src", "lib", "actor.ts");
    expect(actor).toMatch(/nothing checks it/i);
    expect(actor).toMatch(/never verified|not.*proven|self-declaration/i);
  });

  it("does not claim on the pricing page that being one or the other buys anything", () => {
    const pricing = prose("src", "app", "pricing", "page.tsx");
    expect(pricing).toMatch(/same plans and the same reach/i);
  });
});

describe("an agent is never sent to the human email flow", () => {
  const raw = readFileSync(
    join(ROOT, "src", "app", "signin", "page.tsx"),
    "utf8",
  );

  it("shows the OAuth providers only on the person path", () => {
    // The provider start links must be gated behind actor === "human"; the AI
    // branch must not begin an OAuth flow. Email is a human account mechanism,
    // and routing an agent through it fakes a verification that does not apply.
    const humanGate = raw.indexOf('actor === "human"');
    expect(humanGate, "the providers must be gated by actor === \"human\"").toBeGreaterThan(-1);

    const startAt = raw.indexOf("/api/auth/start");
    expect(startAt, "no provider start link found").toBeGreaterThan(-1);
    expect(
      startAt > humanGate,
      "the OAuth start link must sit inside the person branch, not before the human/AI split.",
    ).toBe(true);

    // After the branch splits to the agent side, there is no second start link.
    const secondStart = raw.indexOf("/api/auth/start", startAt + 1);
    expect(
      secondStart,
      "the agent branch must not also start an OAuth flow.",
    ).toBe(-1);
  });

  it("offers an agent a keyed login with no email, and nothing to verify", () => {
    const flat = raw.replace(/\s+/g, " ");
    // The agent path is a real login now - proof of a key, not an email.
    expect(raw).toMatch(/AgentLogin/);
    expect(flat).toMatch(/no email/i);
    expect(flat).toMatch(/nothing to verify/i);
    // and points reading at the open API too
    expect(flat).toMatch(/\/api\/v1\/live/);
  });

  it("uses a drawn icon, not an emoji, for the actor", () => {
    // The emoji sat badly in serif text; the mark is <ActorIcon>.
    expect(raw).toMatch(/ActorIcon/);
    for (const file of ["signin", "pricing", "account"]) {
      const src = readFileSync(
        join(ROOT, "src", "app", file, "page.tsx"),
        "utf8",
      );
      expect(src, `${file} must not use the emoji symbol`).not.toMatch(/👤|🤖|\.symbol\b/);
    }
  });
});
