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

  it("tells a reader on the privacy page exactly what is in that key", async () => {
    /**
     * The privacy page is where somebody decides whether to trust this, so a
     * sentence there that overstates what a contributor learns is the worst
     * kind of stale copy — it describes a leak that was closed and invites a
     * reader to take a precaution against nothing, while teaching them the
     * page cannot be relied on.
     *
     * It said the key your browser presents "states a tier and a pseudonymous
     * subject". The tier half stopped being true when the tier stopped
     * crossing the connection. Asserted against a real minted key rather than
     * against a phrase, so the page cannot drift from the claim again.
     */
    const claims = decodeJwt(
      await tokens.mintNodeKey({
        sub: "s_reader",
        audience: "s_contributor",
        sessionSecondsLeft: 900,
      }),
    );
    expect(claims).not.toHaveProperty("tier");
    expect(claims).not.toHaveProperty("discovery");

    const privacy = readFileSync(
      join(ROOT, "src", "app", "privacy", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(privacy).not.toMatch(/presents states a tier|carries your tier to/i);
  });

  it("has no paywall component left to render", () => {
    const files = walk(join(ROOT, "src")).map((f) =>
      relative(ROOT, f).split(sep).join("/"),
    );
    expect(files).not.toContain("src/components/paywall.tsx");
  });
});

describe("the reader asks a node for nothing it no longer sends", () => {
  /**
   * The half-removed path this file exists to prevent, found on the reader
   * side rather than the node side.
   *
   * `NodeProposalForm` fetched a column and refused to open unless
   * `column.entitled` was true. The node stopped sending that field when the
   * gate was removed, so the check read `undefined` and every proposal form
   * on every column failed closed with "You can only propose edits to a
   * column you can read in full." — a paywall message about a paywall that
   * does not exist, on content that is served whole to anybody.
   *
   * Nothing caught it because the scans looked at `node/` for a gate being
   * applied and at components for a badge being rendered. This looks at the
   * seam between them: what the client expects a node to say.
   */
  function readerSources() {
    // Both readers. The CLI fetches the same endpoint as the browser and had
    // the same stale expectation, which no scan of `src/` would have found.
    return [...walk(join(ROOT, "src")), ...walk(join(ROOT, "scripts"))]
      .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes(".test."))
      .map((file) => ({
        rel: relative(ROOT, file).split(sep).join("/"),
        code: stripCommentsAndStrings(readFileSync(file, "utf8")),
      }));
  }

  it("branches on no entitlement field from a node", () => {
    for (const { rel, code } of readerSources()) {
      expect(code, `${rel} still reads an entitlement`).not.toMatch(
        /\bentitled\b|\baccess:\s*["'`]?(member|lab|public)/,
      );
    }
  });

  it("is not sent one either", () => {
    const server = stripCommentsAndStrings(
      readFileSync(join(ROOT, "node", "server.ts"), "utf8"),
    );
    expect(server).not.toMatch(/\bentitled\b/);
  });

  it("expects no withheld sections in either reader", () => {
    // The preview mechanism: a gated column came back with a count of what
    // had been removed, and both readers printed "preview only". There is no
    // preview, so a reader still describing one is describing nothing.
    for (const { rel, code } of readerSources()) {
      expect(code, `${rel} expects a preview`).not.toMatch(
        /\bhiddenBlocks\b|\bwithheldClaimCount\b/,
      );
    }
  });

  it("has no locked state left to render", () => {
    // `NodeProposalList` kept a `locked` branch for the node's 403, and the
    // copy behind it — "reading them needs the same membership as reading the
    // column" — is the clearest statement of the removed model left anywhere
    // in the app. The node stopped refusing, so the branch is unreachable and
    // the sentence is a promise about a thing that does not exist.
    for (const { rel, code } of readerSources()) {
      expect(code, `${rel} still has a locked state`).not.toMatch(
        /\blocked\b|setLocked/,
      );
    }
  });

  it("renders no access marker beside a listed item", () => {
    // `cephroom live` printed `[${item.access}]` next to anything not
    // "public". The listing endpoint stopped sending `access`, so every row
    // in the CLI read `[undefined]` — the badge outliving the thing it was
    // a badge for, in the one reader nobody looks at in a browser.
    for (const { rel, code } of readerSources()) {
      expect(code, `${rel} still reads an access level`).not.toMatch(
        /item\.access|\.access === |accessLabel/i,
      );
    }
  });

  it("refuses a proposal for a reason a reader can act on", () => {
    // The message that was being shown. If a form ever refuses again it must
    // be for something the reader can do something about, not for a tier.
    const form = readFileSync(
      join(ROOT, "src", "components", "node-proposal-form.tsx"),
      "utf8",
    );
    expect(form).not.toMatch(/read in full|only propose edits to a column you/i);
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

describe("both pricing pages read as a newcomer would read them", () => {
  /**
   * Walked as somebody who has never seen the old model, which is the only
   * useful reader: they cannot tell a stale sentence from a current one, so
   * every sentence on the page is a claim the platform is making today.
   *
   * The headers of both pages were rewritten when the subscriptions were
   * split. The FAQs were not, and an FAQ is the part people actually read —
   * so `/pricing` was still answering "what do I get for free?" with "not
   * the inspector, and not the columns their authors have marked
   * member-only", describing a paywall that no longer exists, on a page
   * whose own header says nothing you pay us unlocks a word of anything.
   */
  const copy = (...parts: string[]) =>
    readFileSync(join(ROOT, "src", "app", ...parts), "utf8").replace(
      /\s+/g,
      " ",
    );

  it("never tells a consumer that paying opens a contributor's work", () => {
    const pricing = copy("pricing", "page.tsx");
    for (const phrase of [
      "member-only",
      "member column",
      "Member unlocks",
      "marked member",
      "premium",
      "exclusive",
      "keep reading throughout",
    ]) {
      expect(pricing, `/pricing says "${phrase}"`).not.toMatch(
        new RegExp(phrase, "i"),
      );
    }

    // "Unlock" may appear, but only in a sentence denying one. The page's
    // whole first paragraph turns on "nothing you pay us unlocks a word of
    // it", so banning the word outright would delete the sentence that does
    // the work.
    for (const sentence of pricing.split(/[.?!]\s/)) {
      if (!/unlock/i.test(sentence)) continue;
      expect(sentence, `an affirmative unlock: "${sentence.trim()}"`).toMatch(
        /\bnothing\b|\bnot\b|\bno\b|\bnever\b|\bnone\b/i,
      );
    }
  });

  it("never tells a contributor that readers are paying them through us", () => {
    const contribute = copy("contribute", "page.tsx");
    for (const phrase of [
      "revenue share",
      "payout",
      "we pay you",
      "earn from readers",
      "paying readers",
      "subscribers",
    ]) {
      expect(contribute, `/contribute says "${phrase}"`).not.toMatch(
        new RegExp(phrase, "i"),
      );
    }
  });

  it("describes the same free reading on both pages", () => {
    // The one fact that has to agree, because a contributor and a consumer
    // reading their own page separately must not come away with different
    // beliefs about who can read what.
    expect(copy("pricing", "page.tsx")).toMatch(
      /readable in full by anybody|free to read|no account at all/i,
    );
    expect(copy("contribute", "page.tsx")).toMatch(
      /whoever finds your work|never gated by what a reader has paid/i,
    );
  });

  it("says in the page description what the plan buys", () => {
    // The description is the first thing a newcomer sees, in a search result,
    // before any of the copy that was rewritten.
    const description = (page: string) =>
      /description:\s*"([^"]+)"/.exec(copy(page, "page.tsx"))?.[1] ?? "";
    expect(description("pricing")).toMatch(/search|discover|reach|find/i);
    expect(description("pricing")).not.toMatch(/member|unlock/i);
    expect(description("contribute")).not.toMatch(/earn|revenue|paid by/i);
  });

  it("keeps a cancelled or failed subscription about reach, not about reading", () => {
    // What a lapsed card costs somebody changed completely: it used to end
    // their access to other people's columns, which we were never in a
    // position to end. It now shortens a listing.
    const pricing = copy("pricing", "page.tsx");
    const failed = pricing.slice(pricing.indexOf("card fails"));
    expect(failed.slice(0, 600)).not.toMatch(/reading|access ends/i);
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
