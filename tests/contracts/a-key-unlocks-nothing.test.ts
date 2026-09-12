import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { decodeJwt } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { ROOT, stripCommentsAndStrings, stripCommentsOnly, walk } from "./scan";

/**
 * A subscription buys something the platform provides. It does not buy
 * anything from a contributor.
 *
 * The old model sold a consumer "contributors will treat you better", and the
 * contributor received nothing for it. It was a promise somebody else had to
 * honour, with no mechanism to make them and no reason to want to: a
 * contributor who noticed would rationally ignore the tier, or serve
 * subscribers *worse* to push them towards paying directly. The platform was
 * taking money for someone else's labour and calling it access.
 *
 * So a consumer's tier no longer crosses the connection. There is no
 * entitlement attached to reading, no member/lab distinction on a column, and
 * a contributor's node has nothing to check. What a contributor charges for
 * is between them and the reader, through `--pay-to`, which the platform
 * relays and knows nothing about.
 *
 * This file is the removal, asserted from the outside: not "the paywall is
 * configured off", but "there is nowhere left to put one". A half-removed
 * entitlement path is worse than either keeping or removing it, so every
 * piece is named.
 */

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

/** Everything a node could read off a reader's key. */
function nodeSources(): { rel: string; code: string }[] {
  return walk(join(ROOT, "node"))
    .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
    .map((file) => ({
      rel: relative(ROOT, file).split(sep).join("/"),
      code: stripCommentsAndStrings(readFileSync(file, "utf8")),
    }));
}

describe("a contributor's node has nothing to check", () => {
  it("reads no tier from anything a reader presents", () => {
    for (const { rel, code } of nodeSources()) {
      expect(code, `${rel} still reads a tier`).not.toMatch(/\btier\b/);
      expect(code, `${rel} still checks entitlement`).not.toMatch(
        /\bentitled\b|\btierAllows\b|\bisEntitling\b/,
      );
    }
  });

  it("has no paywall to apply", () => {
    const files = walk(join(ROOT, "node")).map((f) =>
      relative(ROOT, f).split(sep).join("/"),
    );
    expect(files).not.toContain("node/column-gate.ts");
    for (const { rel, code } of nodeSources()) {
      expect(code, `${rel}`).not.toMatch(/gateColumnBody|hiddenBlocks|withheldClaim/);
    }
  });

  it("serves a column whole, to anyone who asks", async () => {
    // The behavioural half. A column has one form, and it is the whole thing.
    const { readColumnFile } = await import("../../node/columns");
    const column = readColumnFile(
      `---\nslug: c\ntitle: T\n---\n\nFirst.\n\nSecond.\n\nThird.\n`,
      "c.md",
    );
    expect(column.body).toContain("First.");
    expect(column.body).toContain("Third.");
    expect(column).not.toHaveProperty("access");
  });

  it("takes no access level from a column's front matter", () => {
    for (const { rel, code } of nodeSources()) {
      expect(code, `${rel}`).not.toMatch(/meta\.access|column\.access/);
    }
  });
});

describe("nothing carries a consumer's tier across the connection", () => {
  it("mints a node key with no tier and no read scopes", async () => {
    const key = await tokens.mintNodeKey({
      sub: "s_reader",
      audience: "s_contributor",
      sessionSecondsLeft: 900,
    });
    const claims = decodeJwt(key);

    expect(claims).not.toHaveProperty("tier");
    expect(JSON.stringify(claims.scp ?? [])).not.toMatch(/read:/);
    // What remains is the only thing a contributor legitimately needs: a
    // stable, scoped pseudonym to attribute a proposal to.
    expect(String(claims.sub).startsWith("n_")).toBe(true);
  });

  it("offers no read scope to grant", async () => {
    const { SCOPES } = await import("@/lib/keys/tokens");
    expect(SCOPES.filter((s) => s.startsWith("read:"))).toEqual([]);
  });

  it("keeps the announcement free of any access level", async () => {
    const { manifestItemSchema } = await import("@/lib/signaling/announcement");
    const parsed = manifestItemSchema.safeParse({
      id: "c",
      title: "T",
      kind: "column",
      tags: [],
      access: "member",
    });
    // Accepted and dropped: an older node still announcing `access` is not an
    // error, it is simply announcing something that no longer means anything.
    expect(parsed.success).toBe(true);
    expect(parsed.success && "access" in parsed.data).toBe(false);
  });

  it("shows no access badge anywhere in the reader", () => {
    for (const file of walk(join(ROOT, "src", "components"))) {
      if (!file.endsWith(".tsx")) continue;
      const code = stripCommentsAndStrings(readFileSync(file, "utf8"));
      const rel = relative(ROOT, file).split(sep).join("/");
      expect(code, `${rel}`).not.toMatch(/ACCESS_LABEL|Paywall|hiddenBlocks/);
    }
  });

  it("has no paywall component left to render", () => {
    const files = walk(join(ROOT, "src")).map((f) =>
      relative(ROOT, f).split(sep).join("/"),
    );
    expect(files).not.toContain("src/components/paywall.tsx");
  });
});

describe("the two subscriptions never mention each other", () => {
  it("keeps a consumer's tier out of anything a contributor sees", async () => {
    const { DISCOVERY_PLANS, SERVING_PLANS } = await import("@/lib/stripe/plans");

    const consumerCopy = Object.values(DISCOVERY_PLANS)
      .flatMap((p) => [p.name, p.tagline, ...p.features])
      .join(" ")
      .toLowerCase();
    const contributorCopy = Object.values(SERVING_PLANS)
      .flatMap((p) => [p.name, p.tagline, ...p.features])
      .join(" ")
      .toLowerCase();

    // A consumer plan must not imply a contributor owes them anything.
    for (const phrase of [
      "member column",
      "paid column",
      "premium content",
      "unlock",
      "full text",
      "exclusive",
      "support contributors",
    ]) {
      expect(consumerCopy, `consumer copy promises "${phrase}"`).not.toContain(
        phrase,
      );
    }

    // A contributor plan must not imply readers are paying them through us.
    for (const phrase of [
      "earn",
      "revenue",
      "paid readers",
      "subscribers pay you",
      "monetis",
      "monetiz",
    ]) {
      expect(
        contributorCopy,
        `contributor copy implies income: "${phrase}"`,
      ).not.toContain(phrase);
    }
  });

  it("sells the consumer discovery, which is the platform's own", async () => {
    const { DISCOVERY_PLANS } = await import("@/lib/stripe/plans");
    const copy = Object.values(DISCOVERY_PLANS)
      .flatMap((p) => [p.tagline, ...p.features])
      .join(" ")
      .toLowerCase();
    expect(copy).toMatch(/search|discover|quer|index|crawl|sweep/);
  });

  it("sells the contributor capacity, which is also the platform's own", async () => {
    const { SERVING_PLANS } = await import("@/lib/stripe/plans");
    const copy = Object.values(SERVING_PLANS)
      .flatMap((p) => [p.tagline, ...p.features])
      .join(" ")
      .toLowerCase();
    expect(copy).toMatch(/serve|announce|listing|capacity|items/);
  });
});

describe("the pages do not imply an obligation either way", () => {
  const page = (...parts: string[]) =>
    readFileSync(join(ROOT, "src", "app", ...parts), "utf8").replace(/\s+/g, " ");

  it("tells a consumer plainly that their plan buys them nothing from a contributor", () => {
    const pricing = page("pricing", "page.tsx");
    expect(pricing).toMatch(
      /does not|buys you nothing|no claim on|nothing from a contributor|not a claim/i,
    );
  });

  it("tells a contributor plainly that nobody is paying them through us", () => {
    const contribute = page("contribute", "page.tsx");
    expect(contribute).toMatch(/never pay you ourselves/i);
    expect(contribute).toMatch(/no bonuses/i);
  });
});
