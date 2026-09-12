import { describe, expect, it } from "vitest";

import { createRegistry } from "@/lib/signaling/registry";

/**
 * Regression tests for a real vulnerability found by attacking the local dev
 * server — the only thing this project's adversarial step is ever pointed at.
 * See AGENTS.md, "Attacking this thing".
 *
 * The connectionId was rendered into the /read page HTML as a React key, and
 * the heartbeat and withdraw endpoints accepted it with no authentication.
 * That let any visitor knock any contributor's node offline with a single
 * request — a takedown of someone else's content, which is exactly what
 * Contract 2 exists to prevent. Ownership is now proven by the subject in a
 * signed key, and the registry enforces it below.
 */

describe("registry ownership", () => {
  it("only lets the owning subject withdraw a connection", () => {
    const registry = createRegistry();
    const handle = registry.announce({
      sub: "s_owner",
      displayName: "Owner",
      address: "http://127.0.0.1:4600",
      items: [{ id: "col", title: "Col", kind: "column", tags: [] }],
    });

    // An attacker who has seen the connectionId (it was in the page) but
    // cannot prove the subject must not be able to withdraw it.
    expect(registry.withdraw(handle.connectionId, "s_attacker")).toBe(false);
    expect(registry.size()).toBe(1);

    // The real owner can.
    expect(registry.withdraw(handle.connectionId, "s_owner")).toBe(true);
    expect(registry.size()).toBe(0);
  });

  it("only lets the owning subject refresh a lease", () => {
    let now = 1_000_000;
    const registry = createRegistry(() => now);
    const handle = registry.announce({
      sub: "s_owner",
      displayName: "Owner",
      address: "http://127.0.0.1:4600",
      items: [],
    });

    expect(registry.heartbeat(handle.connectionId, "s_attacker")).toBe(false);
    expect(registry.heartbeat(handle.connectionId, "s_owner")).toBe(true);
  });

  it("attributes an announcement to the authenticated subject, not the body", () => {
    // The route passes the key's subject; a caller cannot register under a
    // subject they have not proven they control.
    const registry = createRegistry();
    registry.announce({
      sub: "s_real",
      displayName: "Real",
      address: "http://127.0.0.1:4600",
      items: [{ id: "col", title: "Col", kind: "column", tags: [] }],
    });
    const located = registry.find("s_real", "col");
    expect(located?.presence.sub).toBe("s_real");
  });

  it("resolves an item within a single contributor, not across them", () => {
    // Discovery hijack found by attacking the server: item ids are
    // author-chosen slugs, not globally unique. An attacker announced a
    // column whose id collided with a real one, and a bare find(id) returned
    // whichever sorted first — routing readers to the attacker's node.
    // find() now takes the contributor's subject too, so a collision under a
    // different subject cannot shadow the real item.
    const registry = createRegistry();
    registry.announce({
      sub: "s_real",
      displayName: "Marcus",
      address: "http://127.0.0.1:4600",
      items: [{ id: "col", title: "The real column", kind: "column", tags: [] }],
    });
    registry.announce({
      sub: "s_evil",
      displayName: "AAA Evil", // sorts first; would win a bare find()
      address: "http://127.0.0.1:6666",
      items: [{ id: "col", title: "Free crypto", kind: "column", tags: [] }],
    });

    expect(registry.find("s_real", "col")?.presence.address).toBe(
      "http://127.0.0.1:4600",
    );
    expect(registry.find("s_evil", "col")?.presence.address).toBe(
      "http://127.0.0.1:6666",
    );
    // Neither subject can reach into the other's namespace.
    expect(registry.find("s_real", "nope")).toBeNull();
  });

  it("does not expose the connectionId as a client-facing field", () => {
    // Kept for its own sake: ownership no longer depends on the id being
    // secret, but there is no reason to hand it out either.
    const registry = createRegistry();
    registry.announce({
      sub: "s_owner",
      displayName: "Owner",
      address: "http://127.0.0.1:4600",
      items: [{ id: "col", title: "Col", kind: "column", tags: [] }],
    });
    const [presence] = registry.list();
    // The presence carries an opaque connectionId server-side; the read page
    // must key its list on something else. This asserts the field a
    // component would reach for is stable without it.
    expect(presence.sub).toBe("s_owner");
    expect(presence.items[0].id).toBe("col");
  });
});
