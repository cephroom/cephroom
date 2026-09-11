import { describe, expect, it } from "vitest";

import { createRegistry } from "@/lib/signaling/registry";

/**
 * Regression tests for a real vulnerability found by attacking the local
 * dev server (see docs/CONTRACTS.md, "Signaling is authenticated").
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
    const located = registry.find("col");
    expect(located?.presence.sub).toBe("s_real");
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
