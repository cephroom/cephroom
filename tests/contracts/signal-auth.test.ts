import { describe, expect, it } from "vitest";

import { createRegistry } from "@/lib/signaling/registry";


describe("registry ownership", () => {
  it("only lets the owning subject withdraw a connection", () => {
    const registry = createRegistry();
    const handle = registry.announce({
      sub: "s_owner",
      displayName: "Owner",
      address: "http://127.0.0.1:4600",
      items: [{ id: "col", title: "Col", kind: "column", tags: [] }],
    });

    expect(registry.withdraw(handle.connectionId, "s_attacker")).toBe(false);
    expect(registry.size()).toBe(1);

    expect(registry.withdraw(handle.connectionId, "s_owner")).toBe(true);
    expect(registry.size()).toBe(0);
  });

  it("only lets the owning subject refresh a lease", () => {
    const now = 1_000_000;
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
    expect(registry.find("s_real", "nope")).toBeNull();
  });

  it("does not expose the connectionId as a client-facing field", () => {
    const registry = createRegistry();
    registry.announce({
      sub: "s_owner",
      displayName: "Owner",
      address: "http://127.0.0.1:4600",
      items: [{ id: "col", title: "Col", kind: "column", tags: [] }],
    });
    const [presence] = registry.list();
    expect(presence.sub).toBe("s_owner");
    expect(presence.items[0].id).toBe("col");
  });
});
