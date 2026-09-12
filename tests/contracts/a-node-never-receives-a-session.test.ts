import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ROOT, stripCommentsOnly, walk } from "./scan";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Contract 2, and the sentence on /privacy that says reading sends a node
 * nothing.
 *
 * A contributor states their own address and the platform relays it unchecked -
 * that is contract 4 working. The consequence nobody had followed through: the
 * reader's browser then fetches an attacker-chosen URL, and fetch defaults to
 * credentials "same-origin". Announce the platform's own origin and the
 * reader's session cookie rides along on a request they never chose to make.
 *
 * Bounded today, because the platform serves no /column/ route. Not bounded in
 * principle, and free to close.
 */
describe("a node fetch never carries the reader's session", () => {
  it("omits credentials, whatever the caller passed", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(init);
        return { ok: true } as Response;
      }),
    );

    const { fetchWithTimeout } = await import("@/lib/fetch-with-timeout");

    await fetchWithTimeout("http://localhost:3000/column/bait");
    await fetchWithTimeout("http://127.0.0.1:4600/column/x", {
      credentials: "include",
    });

    expect(seen).toHaveLength(2);
    for (const init of seen) {
      expect(
        init.credentials,
        [
          "An announced address is attacker-controlled. If it names the",
          "platform's own origin - or redirects to it - a default fetch attaches",
          "the reader's cephroom_key cookie to a request the reader never chose",
          "to make.",
          "",
          "/privacy says reading sends a node no key at all. This is what makes",
          "that unconditionally true.",
        ].join("\n"),
      ).toBe("omit");
    }
  });

  it("cannot be overridden by a caller passing credentials", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(init);
        return { ok: true } as Response;
      }),
    );

    const { fetchWithTimeout } = await import("@/lib/fetch-with-timeout");
    await fetchWithTimeout("http://x.test/column/y", {
      credentials: "same-origin",
      headers: { authorization: "Bearer node-scoped" },
    });

    expect(seen[0].credentials).toBe("omit");
    expect(
      (seen[0].headers as Record<string, string>).authorization,
      "A node key is still allowed: it is scoped to that node and useless elsewhere. It is the ambient cookie that must never travel.",
    ).toBe("Bearer node-scoped");
  });

  it("sends no referrer, so a node is not told which platform page sent the reader", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(init);
        return { ok: true } as Response;
      }),
    );

    const { fetchWithTimeout } = await import("@/lib/fetch-with-timeout");
    await fetchWithTimeout("http://127.0.0.1:4600/column/x");

    expect(seen[0].referrerPolicy).toBe("no-referrer");
  });

  it("is the only way any component reaches a node", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src", "components"))) {
      if (!file.endsWith(".tsx") || file.includes(".test.")) continue;
      const code = stripCommentsOnly(readFileSync(file, "utf8"));
      if (!/\/(column|dataset|manifest|proposals)\b/.test(code)) continue;
      if (/(?<!WithTimeout)\bfetch\s*\(/.test(code)) {
        offenders.push(file.split(/[\\/]/).pop()!);
      }
    }
    expect(
      offenders,
      `These reach a node with a bare fetch, which bypasses the credentials rule above.\n${offenders.join("\n")}\n`,
    ).toEqual([]);
  });
});

describe("the platform refuses to be announced as a serving node", () => {
  it("rejects an address on its own origin", async () => {
    const { isPlatformOrigin } = await import("@/lib/signaling/announcement");

    expect(isPlatformOrigin("http://localhost:3000", "http://localhost:3000")).toBe(true);
    expect(isPlatformOrigin("http://localhost:3000/x", "http://localhost:3000")).toBe(true);
    expect(isPlatformOrigin("HTTP://LocalHost:3000", "http://localhost:3000")).toBe(true);
  });

  it("allows a node on the same host but a different port", async () => {
    const { isPlatformOrigin } = await import("@/lib/signaling/announcement");

    expect(
      isPlatformOrigin("http://localhost:4600", "http://localhost:3000"),
      "A contributor running on the same machine is the normal case and must keep working.",
    ).toBe(false);
    expect(isPlatformOrigin("http://127.0.0.1:4600", "http://localhost:3000")).toBe(false);
    expect(isPlatformOrigin("https://ada.example.org", "http://localhost:3000")).toBe(false);
  });

  it("treats an unparseable address as not ours rather than throwing", async () => {
    const { isPlatformOrigin } = await import("@/lib/signaling/announcement");
    expect(isPlatformOrigin("not a url", "http://localhost:3000")).toBe(false);
    expect(isPlatformOrigin("http://x", "also not a url")).toBe(false);
  });

  it("is wired into the announce route", () => {
    const route = stripCommentsOnly(
      readFileSync(join(ROOT, "src", "app", "api", "signal", "route.ts"), "utf8"),
    );
    expect(
      route,
      "The platform is never a serving node, so an announcement naming it is either a mistake or an attempt to make a reader's browser fetch it with their session attached.",
    ).toContain("isPlatformOrigin");
  });
});
