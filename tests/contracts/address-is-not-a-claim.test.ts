import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT, stripCommentsOnly } from "./scan";
import { servingMismatch } from "@/lib/signaling/serving";


describe("a node states who it is, in everything it serves", () => {
  const server = stripCommentsOnly(readFileSync(join(ROOT, "node", "server.ts"), "utf8"));

  it("names its subject on a column", () => {
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
    expect(problem).toContain("s_nodeA_marcus");
    expect(problem).toContain("s_nodeB_ines");
  });

  it("rejects a node that will not say who it is", () => {
    expect(servingMismatch("s_nodeA_marcus", undefined)).not.toBeNull();
    expect(servingMismatch("s_nodeA_marcus", "")).not.toBeNull();
  });

  it("does not compare loosely", () => {
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
    expect(cli).toContain("servingMismatch");
  });

  it("checks it before pulling the datasets a claim is checked against", () => {
    const check = cli.indexOf("servingMismatch");
    const datasets = cli.indexOf("/dataset/");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(datasets);
  });

  it("uses the shared helper rather than a second copy of the rule", () => {
    expect(cli).toContain("signaling/serving");
  });
});

describe("the platform does not try to check it itself", () => {
  it("makes no request to a node in order to verify an announcement", () => {
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
