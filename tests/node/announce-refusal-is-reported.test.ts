import { describe, expect, it } from "vitest";

import { AnnounceRefused, PresenceLoop } from "../../node/presence";

function loop(announce: () => Promise<number>) {
  const scheduled: { ms: number; fn: () => void }[] = [];
  const failures: { detail: string; permanent: boolean }[] = [];

  const presence = new PresenceLoop({
    announce,
    beat: async () => 200,
    schedule: (ms, fn) => {
      scheduled.push({ ms, fn });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: () => {},
    onFailure: (detail, permanent) => failures.push({ detail, permanent }),
  });

  return { presence, scheduled, failures };
}

const REFUSAL =
  "This key may announce 25 items at once; the announcement has 40. Serving is free and this is only about volume.";

describe("a contributor is told why the platform refused them", () => {
  it("reports the platform's own words, not a guess about the network", async () => {
    const { presence, failures } = loop(async () => {
      throw new AnnounceRefused(413, REFUSAL);
    });

    await presence.start();

    expect(failures).toHaveLength(1);
    expect(failures[0].detail).toContain("25 items at once");
    expect(
      failures[0].detail,
      [
        "The platform answered with a reason the contributor can act on and the",
        "node replaced it with 'could not reach the platform yet'. All three of",
        "the things that message says were false: the platform was reachable,",
        "nothing was going to resolve itself, and the actual reason was thrown",
        "away.",
      ].join("\n"),
    ).not.toMatch(/could not reach/i);
  });

  it("calls a refusal permanent, because retrying an oversized announcement never helps", async () => {
    const { presence, failures } = loop(async () => {
      throw new AnnounceRefused(413, REFUSAL);
    });

    await presence.start();
    expect(failures[0].permanent).toBe(true);
    expect(presence.connected()).toBe(false);
  });

  it("calls a network failure transient, because that one does resolve itself", async () => {
    const { presence, failures } = loop(async () => {
      throw new Error("fetch failed");
    });

    await presence.start();
    expect(failures[0].permanent).toBe(false);
    expect(presence.connected()).toBe(false);
  });

  it("treats a server error as transient rather than as the contributor's fault", async () => {
    const { presence, failures } = loop(async () => {
      throw new AnnounceRefused(503, "Busy.");
    });

    await presence.start();
    expect(failures[0].permanent).toBe(false);
  });

  it("treats being rate limited as transient", async () => {
    const { presence, failures } = loop(async () => {
      throw new AnnounceRefused(429, "Slow down.");
    });

    await presence.start();
    expect(failures[0].permanent).toBe(false);
  });

  it("keeps retrying after a permanent refusal, so raising a plan heals it", async () => {
    const { presence, scheduled } = loop(async () => {
      throw new AnnounceRefused(413, REFUSAL);
    });

    await presence.start();

    expect(
      scheduled.length,
      "A refusal must not stop the loop: a contributor who raises their plan should come online without restarting the node.",
    ).toBe(1);
  });

  it("does not repeat the same reason on every retry", async () => {
    const { presence, scheduled, failures } = loop(async () => {
      throw new AnnounceRefused(413, REFUSAL);
    });

    await presence.start();
    await scheduled[0].fn();
    await scheduled[scheduled.length - 1].fn();

    expect(
      failures,
      "A node that reprints the same refusal every thirty seconds trains its operator to ignore the log.",
    ).toHaveLength(1);
  });

  it("reports again when the reason changes", async () => {
    let detail = REFUSAL;
    const { presence, scheduled, failures } = loop(async () => {
      throw new AnnounceRefused(413, detail);
    });

    await presence.start();
    detail = "This key may announce 25 items at once; the announcement has 41.";
    await scheduled[0].fn();

    expect(failures).toHaveLength(2);
    expect(failures[1].detail).toContain("41");
  });

  it("clears the reported failure once the announcement succeeds", async () => {
    let fail = true;
    const { presence, scheduled } = loop(async () => {
      if (fail) throw new AnnounceRefused(413, REFUSAL);
      return 15;
    });

    await presence.start();
    expect(presence.lastFailure()).not.toBeNull();

    fail = false;
    await scheduled[0].fn();

    expect(presence.connected()).toBe(true);
    expect(presence.lastFailure()).toBeNull();
  });
});

describe("AnnounceRefused carries what the platform said", () => {
  it("keeps the status and the body", () => {
    const refused = new AnnounceRefused(413, REFUSAL);
    expect(refused.status).toBe(413);
    expect(refused.detail).toBe(REFUSAL);
    expect(refused.message).toContain(REFUSAL);
  });

  it("knows which statuses the contributor has to act on", () => {
    expect(new AnnounceRefused(400, "x").permanent).toBe(true);
    expect(new AnnounceRefused(401, "x").permanent).toBe(true);
    expect(new AnnounceRefused(413, "x").permanent).toBe(true);
    expect(new AnnounceRefused(429, "x").permanent).toBe(false);
    expect(new AnnounceRefused(408, "x").permanent).toBe(false);
    expect(new AnnounceRefused(500, "x").permanent).toBe(false);
    expect(new AnnounceRefused(503, "x").permanent).toBe(false);
  });
});
