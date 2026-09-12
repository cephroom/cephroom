import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { safeExternalUrl } from "@/lib/safe-url";
import { ROOT, stripCommentsOnly, walk } from "./scan";

/**
 * Contract 4 says a node states its own address and the reader checks it. The
 * same applies to everything else a node says, and a URL is the sharp case:
 * front matter reaches an href without passing through anything.
 *
 * React 19 happens to block javascript: hrefs. React 16 and 18 only warned.
 * Depending on which release is installed for a security property is the
 * failure mode this suite exists to prevent - a rule that has stopped matching
 * looks exactly like a rule that is passing.
 */
describe("a URL from a node is checked before it becomes a link", () => {
  it("refuses the scheme that executes", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeExternalUrl(" javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("java\tscript:alert(1)")).toBeNull();
  });

  it("refuses the schemes that carry a document", () => {
    expect(safeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeExternalUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeExternalUrl("blob:http://localhost:3000/x")).toBeNull();
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
  });

  it("refuses a protocol-relative URL, which is not the host it looks like", () => {
    expect(
      safeExternalUrl("//evil.example/torvalds/linux"),
      "Rendered next to a repo label this reads as a path and navigates to another origin.",
    ).toBeNull();
  });

  it("refuses anything that is not a URL at all", () => {
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl("   ")).toBeNull();
    expect(safeExternalUrl("not a url")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });

  it("allows the two schemes a repository link actually uses", () => {
    expect(safeExternalUrl("https://github.com/torvalds/linux")).toBe(
      "https://github.com/torvalds/linux",
    );
    expect(safeExternalUrl("http://example.org/x")).toBe("http://example.org/x");
  });

  it("does not rewrite a URL it accepts", () => {
    const given = "https://example.org/a/b?c=d&e=f#g";
    expect(
      safeExternalUrl(given),
      "Rewriting is parsing. A contributor's link is theirs; the only question here is whether it is safe to attach to an href.",
    ).toBe(given);
  });
});

describe("the reader does not depend on React to block it", () => {
  const reader = stripCommentsOnly(
    readFileSync(join(ROOT, "src", "components", "column-reader.tsx"), "utf8"),
  );

  it("passes a node-supplied repo link through the check", () => {
    expect(reader).toContain("safeExternalUrl");
    expect(
      reader,
      "column.repo reached href={} directly. That made the platform's safety a property of the installed React version.",
    ).not.toMatch(/href=\{column\.repo\}/);
  });

  it("attaches no node-supplied value to an href without checking it", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src", "components"))) {
      if (!file.endsWith(".tsx") || file.includes(".test.")) continue;
      const code = stripCommentsOnly(readFileSync(file, "utf8"));
      for (const match of code.matchAll(/href=\{([^}]+)\}/g)) {
        const expr = match[1].trim();
        const templated = expr.startsWith("`");
        const checked = /safe|Safe/.test(expr);
        const local = /^["'/]|^href$|^`\/|^`\$\{base\}/.test(expr);
        const nodeSupplied = /(column|dataset|presence|served|manifest)\.|repo|payTo/.test(expr);
        if (!templated && !checked && !local && nodeSupplied) {
          offenders.push(`${file.split(/[\\/]/).pop()}: href={${expr}}`);
        }
      }
    }
    expect(offenders, `\n${offenders.join("\n")}\n`).toEqual([]);
  });
});

describe("a payment string is still not a link", () => {
  it("stays text, because turning it into one would be parsing it", () => {
    const reader = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "components", "column-reader.tsx"), "utf8"),
    );
    const near = reader.slice(reader.indexOf("payTo &&"), reader.indexOf("payTo &&") + 600);
    expect(
      near,
      "Contract 5: relayed verbatim, never parsed. Deciding it is a URL and making it clickable is a decision about what it means.",
    ).not.toMatch(/href=\{[^}]*payTo/);
  });
});
