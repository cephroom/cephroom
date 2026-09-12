import { describe, expect, it } from "vitest";

import {
  buildRequests,
  finalizeBatch,
  issueBatch,
  publishedKeys,
  redeem,
} from "@/lib/tokens/issuer";


async function keyFor(tier: "query" | "sweep"): Promise<Uint8Array> {
  const keys = await publishedKeys();
  const found = keys.find((key) => key.tier === tier);
  if (!found) throw new Error(`no published key for ${tier}`);
  return Uint8Array.from(Buffer.from(found.publicKey, "base64"));
}

async function subscriberGetsTokens(
  tier: "query" | "sweep",
  count: number,
): Promise<{ tokens: string[]; seenByPlatform: string[] }> {
  const publicKey = await keyFor(tier);
  const { clients, requests } = await buildRequests(publicKey, count);

  const { responses } = await issueBatch(
    tier,
    requests.map((request) => Uint8Array.from(Buffer.from(request, "base64"))),
  );

  return {
    tokens: await finalizeBatch(clients, responses),
    seenByPlatform: [...requests, ...responses],
  };
}

describe("Layer 1 protects a search history, not a paywall", () => {
  it("issues against discovery plans, and only the paid ones", async () => {
    const { TOKEN_TIERS } = await import("@/lib/tokens/issuer");
    const { DISCOVERY_ORDER } = await import("@/lib/stripe/plans");
    expect([...TOKEN_TIERS].sort()).toEqual(
      DISCOVERY_ORDER.filter((id) => id !== "browse").sort(),
    );
  });

  it("lets a query be spent without a cookie", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT, stripCommentsOnly } = await import("./scan");

    const live = stripCommentsOnly(
      readFileSync(
        join(ROOT, "src", "app", "api", "v1", "live", "route.ts"),
        "utf8",
      ),
    );
    expect(live).toContain("authorization");
    expect(live).toContain("verifyAccessKey");
  });

  it("says everywhere it is described what they are for", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT } = await import("./scan");

    const surfaces = [
      ["src", "app", "account", "page.tsx"],
      ["src", "components", "token-wallet.tsx"],
      ["src", "app", "privacy", "page.tsx"],
    ];

    for (const parts of surfaces) {
      const copy = readFileSync(join(ROOT, ...parts), "utf8").replace(
        /\s+/g,
        " ",
      );
      const where = parts.join("/");
      expect(copy, `${where} does not say what a token hides`).toMatch(
        /search|quer/i,
      );
      expect(copy, `${where} still calls them reading tokens`).not.toMatch(
        /anonymous reading|reading token|reading session/i,
      );
      expect(copy, `${where} still says membership`).not.toMatch(
        /\bmembership\b|\bmember\b/,
      );
    }
  });

  it("spends them on the search, not on a node", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT, stripCommentsOnly } = await import("./scan");

    const cli = stripCommentsOnly(
      readFileSync(join(ROOT, "scripts", "cephroom.ts"), "utf8"),
    );
    const body = (name: string) => {
      const start = cli.indexOf(`async function ${name}(`);
      expect(start, `no ${name}`).toBeGreaterThan(-1);
      const next = cli.indexOf("\nasync function ", start + 1);
      return cli.slice(start, next === -1 ? undefined : next);
    };

    const read = body("cmdRead");
    expect(read).not.toMatch(/readKey|authorization/);

    expect(body("cmdLive")).toMatch(/readKey/);
  });

  it("spends none of them in the browser's reader either", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT, stripCommentsOnly } = await import("./scan");

    const reader = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "components", "column-reader.tsx"), "utf8"),
    );
    expect(reader).not.toMatch(/spendToken/);
    const fetchCall = reader.slice(reader.indexOf("/column/"));
    expect(fetchCall.slice(0, 400)).not.toMatch(/authorization/i);
  });

  it("spends one on the search the site itself runs", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT, stripCommentsOnly } = await import("./scan");

    const search = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "components", "live-search.tsx"), "utf8"),
    );
    expect(search).toMatch(/spendToken/);
    expect(search).toMatch(/api\/v1\/live/);
  });

  it("does not offer them where they would buy nothing", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT } = await import("./scan");
    const wallet = readFileSync(
      join(ROOT, "src", "components", "token-wallet.tsx"),
      "utf8",
    );
    expect(wallet).not.toMatch(/\bentitled\b/);
  });
});

describe("Layer 1: a redemption cannot be traced to its issuance", () => {
  it("issues tokens the platform has never seen the contents of", async () => {
    const { tokens, seenByPlatform } = await subscriberGetsTokens("query", 2);

    const wire = seenByPlatform.join("|");
    for (const token of tokens) {
      expect(wire).not.toContain(token);
      expect(wire).not.toContain(token.slice(0, 32));
    }
  });

  it("makes two tokens from one issuance indistinguishable from two from different issuances", async () => {
    const alice = await subscriberGetsTokens("query", 2);
    const bob = await subscriberGetsTokens("query", 2);

    const aliceFirst = await redeem(
      Uint8Array.from(Buffer.from(alice.tokens[0], "base64")),
    );
    const aliceSecond = await redeem(
      Uint8Array.from(Buffer.from(alice.tokens[1], "base64")),
    );
    const bobFirst = await redeem(
      Uint8Array.from(Buffer.from(bob.tokens[0], "base64")),
    );

    expect(aliceFirst).not.toBeNull();
    expect(aliceSecond).not.toBeNull();
    expect(bobFirst).not.toBeNull();

    const shapes = [aliceFirst!, aliceSecond!, bobFirst!].map((r) => ({
      tier: r.tier,
      epoch: r.epoch,
      nullifierLength: r.nullifier.length,
      fields: Object.keys(r).sort(),
    }));

    expect(shapes[0]).toEqual(shapes[1]);
    expect(shapes[0]).toEqual(shapes[2]);

    const [a1, a2, b1] = [
      aliceFirst!.nullifier,
      aliceSecond!.nullifier,
      bobFirst!.nullifier,
    ];
    expect(a1).not.toBe(a2);
    expect(a1.slice(0, 8)).not.toBe(a2.slice(0, 8));
    expect(a1.slice(0, 8)).not.toBe(b1.slice(0, 8));
  });

  it("yields no subject, customer, or issuance reference at redemption", async () => {
    const { tokens } = await subscriberGetsTokens("sweep", 1);
    const result = await redeem(
      Uint8Array.from(Buffer.from(tokens[0], "base64")),
    );

    expect(Object.keys(result!).sort()).toEqual(["epoch", "nullifier", "tier"]);
  });

  it("carries the tier, and nothing finer", async () => {
    const query = await subscriberGetsTokens("query", 1);
    const sweep = await subscriberGetsTokens("sweep", 1);

    const asQuery = await redeem(
      Uint8Array.from(Buffer.from(query.tokens[0], "base64")),
    );
    const asSweep = await redeem(
      Uint8Array.from(Buffer.from(sweep.tokens[0], "base64")),
    );

    expect(asQuery!.tier).toBe("query");
    expect(asSweep!.tier).toBe("sweep");
  });

  it("uses a fixed redemption context, so a batch cannot be marked", async () => {
    const first = await subscriberGetsTokens("query", 1);
    const second = await subscriberGetsTokens("query", 1);

    const a = await redeem(
      Uint8Array.from(Buffer.from(first.tokens[0], "base64")),
    );
    const b = await redeem(
      Uint8Array.from(Buffer.from(second.tokens[0], "base64")),
    );

    expect(a!.tier).toBe(b!.tier);
    expect(a!.epoch).toBe(b!.epoch);
  });

  it("refuses a token that verifies against no live key", async () => {
    const forged = new Uint8Array(354);
    forged.set([0, 2], 0);
    expect(await redeem(forged)).toBeNull();
    expect(await redeem(new Uint8Array(0))).toBeNull();
    expect(await redeem(Uint8Array.from([1, 2, 3]))).toBeNull();
  });

  it("refuses a token whose signature has been tampered with", async () => {
    const { tokens } = await subscriberGetsTokens("query", 1);
    const bytes = Uint8Array.from(Buffer.from(tokens[0], "base64"));
    bytes[bytes.length - 1] ^= 0x01;
    expect(await redeem(bytes)).toBeNull();
  });

  it("does not let a Query token buy Sweep reach", async () => {
    const { tokens } = await subscriberGetsTokens("query", 1);
    const result = await redeem(
      Uint8Array.from(Buffer.from(tokens[0], "base64")),
    );
    expect(result!.tier).toBe("query");
  });
});
