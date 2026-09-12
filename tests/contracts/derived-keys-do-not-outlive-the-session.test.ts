import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decodeJwt } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "./scan";


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

const lifeOf = (jwt: string) => {
  const claims = decodeJwt(jwt);
  return claims.exp! - claims.iat!;
};

describe("a node key is capped by what is left of the session", () => {
  it("lives its full span when the session has plenty left", async () => {
    const key = await tokens.mintNodeKey({
      sub: "s_reader",
      audience: "s_node",
      sessionSecondsLeft: tokens.ACCESS_TTL_SECONDS,
    });
    expect(lifeOf(key)).toBe(tokens.NODE_KEY_TTL_SECONDS);
  });

  it("is cut short when the session is nearly over", async () => {
    const key = await tokens.mintNodeKey({
      sub: "s_reader",
      audience: "s_node",
      sessionSecondsLeft: 1,
    });
    expect(lifeOf(key)).toBe(1);
  });

  it("never exceeds the session, at any point in it", async () => {
    for (const left of [0, 1, 30, 119, 120, 121, 600, 900]) {
      const key = await tokens.mintNodeKey({
        sub: "s_reader",
        audience: "s_node",
        sessionSecondsLeft: left,
      });
      expect(lifeOf(key), `with ${left}s of session left`).toBeLessThanOrEqual(left);
      expect(lifeOf(key)).toBeLessThanOrEqual(tokens.NODE_KEY_TTL_SECONDS);
    }
  });

  it("mints an already-dead key rather than a live one when the session is gone", async () => {
    const key = await tokens.mintNodeKey({
      sub: "s_reader",
      audience: "s_node",
      sessionSecondsLeft: 0,
    });
    expect(lifeOf(key)).toBe(0);
    expect(await tokens.verifyAccessKey(key, { audience: "s_node" })).toBeNull();
  });

  it("holds the bound the site actually promises", () => {
    const worstCase = tokens.ACCESS_TTL_SECONDS;
    expect(worstCase).toBe(15 * 60);

    const howItWorks = readFileSync(
      join(ROOT, "src", "app", "how-it-works", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(howItWorks).toMatch(/cancellation reaches you within fifteen minutes/i);
  });
});

describe("every caller passes the session it derived from", () => {
  it("requires it, so it cannot be forgotten", async () => {
    const source = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "lib", "keys", "tokens.ts"), "utf8"),
    );
    const mint = source.slice(source.indexOf("export async function mintNodeKey"));
    expect(mint.slice(0, 300)).toMatch(/sessionSecondsLeft:\s*number/);
    expect(mint.slice(0, 300)).not.toMatch(/sessionSecondsLeft\?:/);
  });

  it("is passed by every page that mints one", () => {
    for (const path of [
      ["src", "app", "read", "[sub]", "[id]", "page.tsx"],
      ["src", "app", "read", "[sub]", "[id]", "proposals", "page.tsx"],
      ["src", "app", "read", "[sub]", "[id]", "propose", "page.tsx"],
    ]) {
      const source = stripCommentsOnly(readFileSync(join(ROOT, ...path), "utf8"));
      if (!source.includes("mintNodeKey")) continue;
      expect(source, path.join("/")).toContain("sessionSecondsLeft");
    }
  });
});
