import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "./scan";
import { servingMismatch } from "@/lib/signaling/serving";

/**
 * An address in the registry is a claim, and the reader is the one who checks it.
 *
 * Found by running two contributors at once and pointing one at the other.
 * Marcus announced, under his own subject and with a key that genuinely
 * proves it, an item whose `address` was Ines's node:
 *
 *   platform tells a reader:
 *      servedBy = Marcus Oyelaran
 *      address  = http://127.0.0.1:4601
 *   the machine at that address says it is: s_nodeB_ines ("Ines Alvarez")
 *
 * Everything the platform checked was true. `sub` came from the key and was
 * Marcus's; the announcement was well-formed. The platform cannot tell
 * whether a machine at an address belongs to the subject announcing it, and
 * it must not try — probing a node would put it in a request to that node,
 * which is the thing Contract 2 spends all its effort keeping it out of.
 *
 * So the check belongs where the connection actually is. The reader is
 * already talking to the node directly; the node already knows who it is; and
 * "continuity is the endpoints' job" is the contract clause that says whose
 * problem this is. The node states its subject in every response, and the
 * reader refuses content from a machine that does not claim to be the
 * contributor it went looking for.
 *
 * What it prevents, concretely: directing readers at somebody else's machine
 * — consuming their bandwidth, showing their work under your byline, and
 * putting their node in front of readers who never chose it.
 */

describe("a node states who it is, in everything it serves", () => {
  const server = stripCommentsOnly(readFileSync(join(ROOT, "node", "server.ts"), "utf8"));

  it("names its subject on a column", () => {
    // On the response itself, not only on /manifest: a reader that had to
    // make a second request to find out would skip it under load, and a
    // check that is easy to skip is not a check.
    const column = server.slice(server.indexOf("/column/"));
    expect(column.slice(0, 3000)).toContain("servedBySub");
  });

  it("names its subject on a dataset", () => {
    const dataset = server.slice(server.indexOf("/dataset/"));
    expect(dataset.slice(0, 3000)).toContain("servedBySub");
  });

  it("names its subject on the manifest", () => {
    expect(server).toMatch(/sub:\s*SUB/);
  });
});

describe("the reader refuses a node that is not who the registry said", () => {
  it("accepts a node that claims the contributor being visited", () => {
    expect(servingMismatch("s_nodeA_marcus", "s_nodeA_marcus")).toBeNull();
  });

  it("rejects a node claiming somebody else", () => {
    const problem = servingMismatch("s_nodeA_marcus", "s_nodeB_ines");
    expect(problem).not.toBeNull();
    // The message has to name both, because the reader's next question is
    // "whose machine am I actually talking to".
    expect(problem).toContain("s_nodeA_marcus");
    expect(problem).toContain("s_nodeB_ines");
  });

  it("rejects a node that will not say who it is", () => {
    // An older node, or one that declines to answer. Unverifiable is not the
    // same as verified, and the safe reading of an absent claim is refusal —
    // announcing someone else's address is precisely what a node that omits
    // its subject would enable.
    expect(servingMismatch("s_nodeA_marcus", undefined)).not.toBeNull();
    expect(servingMismatch("s_nodeA_marcus", "")).not.toBeNull();
  });

  it("does not compare loosely", () => {
    // No trimming, no case folding, no prefix matching. A subject is an exact
    // string and a near-match is a different contributor.
    expect(servingMismatch("s_nodeA_marcus", " s_nodeA_marcus")).not.toBeNull();
    expect(servingMismatch("s_nodeA_marcus", "s_nodea_marcus")).not.toBeNull();
    expect(servingMismatch("s_nodeA_marcus", "s_nodeA_marcus2")).not.toBeNull();
  });

  it("is wired into the column reader", () => {
    const reader = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "components", "column-reader.tsx"), "utf8"),
    );
    expect(reader).toContain("servingMismatch");
  });

  it("is wired into the dataset reader", () => {
    const reader = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "components", "dataset-reader.tsx"), "utf8"),
    );
    expect(reader).toContain("servingMismatch");
  });

  it("is checked before the content is rendered, not after", () => {
    // Rendering first and warning afterwards would still have served the
    // bytes, and the reader would still have made the request that matters.
    const reader = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "components", "column-reader.tsx"), "utf8"),
    );
    const check = reader.indexOf("servingMismatch");
    const render = reader.indexOf('setPhase({ state: "ready"');
    expect(check).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(-1);
    expect(check).toBeLessThan(render);
  });
});

describe("the reader is told what actually went wrong", () => {
  const reader = stripCommentsOnly(
    readFileSync(join(ROOT, "src", "components", "column-reader.tsx"), "utf8"),
  );

  it("does not report an impostor as an unreachable node", () => {
    // The first version of this fix routed a mismatch through the existing
    // offline state, so the page said "Marcus Oyelaran's node stopped
    // answering" about a node that had answered immediately and correctly.
    // The detail line underneath was accurate, which made the headline worse
    // rather than better: the reader is given a wrong explanation first and a
    // right one second.
    //
    // This is a publication about evidence quality. A heading that misstates
    // what happened is the exact failure it exists to catch.
    expect(reader).toContain('state: "impostor"');
  });

  it("names the impersonation in the heading, not only in the detail", () => {
    const block = reader.slice(reader.indexOf('phase.state === "impostor"'));
    const heading = block.slice(0, block.indexOf("</h1>"));
    expect(heading).not.toMatch(/stopped answering|did not reach/);
    expect(heading.toLowerCase()).toMatch(/not|another|someone|somebody|impost/);
  });

  it("keeps the two states separate rather than sharing a branch", () => {
    expect(reader).toContain('phase.state === "offline"');
    expect(reader).toContain('phase.state === "impostor"');
  });

  it("still shows nothing it fetched from the wrong machine", () => {
    // Refusing to render is the point. Showing the content with a warning
    // attached would mean the impersonation worked.
    const block = reader.slice(reader.indexOf('phase.state === "impostor"'));
    const branch = block.slice(0, block.indexOf("</main>"));
    expect(branch).not.toContain("ReactMarkdown");
    expect(branch).not.toContain("column.prose");
  });
});

describe("a reader on the CLI is protected the same way", () => {
  const cli = stripCommentsOnly(
    readFileSync(join(ROOT, "scripts", "cephroom.ts"), "utf8"),
  );

  it("checks the node's claim before rendering a column", () => {
    // The browser check was written first and the CLI was left exposed for a
    // while, which is the shape this project's own API contract exists to
    // prevent: /account promises "Everything the site does, the API does."
    // A defence that only reaches browsers is a defence with a documented
    // bypass.
    expect(cli).toContain("servingMismatch");
  });

  it("checks it before pulling the datasets a claim is checked against", () => {
    // The dataset fetches come second and go to the same machine. Checking
    // after them would mean a wrong node had already answered the requests
    // that decide whether a claim reads as verified.
    const check = cli.indexOf("servingMismatch");
    const datasets = cli.indexOf("/dataset/");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(datasets);
  });

  it("uses the shared helper rather than a second copy of the rule", () => {
    // Two implementations of the same check drift, and this one decides
    // whether a reader is looking at the right person's work.
    expect(cli).toContain("signaling/serving");
  });
});

describe("the platform does not try to check it itself", () => {
  it("makes no request to a node in order to verify an announcement", () => {
    // The tempting fix, and the wrong one. Probing an announced address would
    // put the platform in a request to a contributor's machine — and would
    // also be worthless, since a node can answer a probe truthfully and serve
    // anything afterwards.
    const signal = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "app", "api", "signal", "route.ts"), "utf8"),
    );
    expect(signal).not.toMatch(/fetch\s*\(/);
  });

  it("still takes the subject from the key rather than the body", () => {
    const announcement = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "lib", "signaling", "announcement.ts"), "utf8"),
    );
    expect(announcement).not.toMatch(/^\s*sub:/m);
  });
});
