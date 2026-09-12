import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT } from "./scan";
import { NullifierStore } from "@/lib/tokens/nullifiers";

/**
 * The bounded exception, held to its bounds.
 *
 * The nullifier set is the first durable-ish thing this platform has, and to
 * accommodate it the storage contract is stated as "no person-linkable data
 * at rest" rather than "nothing at rest". That is a real weakening of the
 * older wording, and it is paid for by keeping the exception exactly as
 * narrow as it was argued to be — here, and on /privacy, which describes the
 * set to readers in full.
 *
 * The failure mode these tests exist to prevent is not dramatic. Nobody is
 * going to add a user table here. Somebody is going to add a timestamp for
 * debugging, or a counter for a dashboard, or the tier "so we can see which
 * plan is being used" — and each of those, individually reasonable, turns an
 * opaque set into a log with a shape that can be correlated against something
 * else. So the assertion is structural: an entry cannot hold a value at all.
 */
describe("a nullifier entry can hold nothing but the fact that it exists", () => {
  it("stores entries in a Set, which has no room for a payload", () => {
    const source = readFileSync(
      join(ROOT, "src", "lib", "tokens", "nullifiers.ts"),
      "utf8",
    );

    // A Set can only remember that something happened. The moment this becomes
    // a Map the door is open, so the door is nailed shut here rather than
    // relied on to stay closed.
    expect(source).toMatch(/Map<number,\s*Set<Nullifier>>/);
    expect(source).not.toMatch(/Map<Nullifier,/);
    expect(source).not.toMatch(/Map<string,\s*\{/);
  });

  it("names no field that could carry identity or time", () => {
    const source = readFileSync(
      join(ROOT, "src", "lib", "tokens", "nullifiers.ts"),
      "utf8",
    );
    // Scrub comments — this file discusses these words at length on purpose.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    for (const forbidden of [
      "Date.now",
      "timestamp",
      "createdAt",
      "seenAt",
      "sub",
      "customerId",
      "ip",
      "userAgent",
      "tier",
    ]) {
      expect(
        code,
        `The nullifier store must not handle "${forbidden}".`,
      ).not.toContain(forbidden);
    }
  });

  it("refuses anything that is not a 32-byte hash", () => {
    const store = new NullifierStore();
    // The store is the last line of defence against something identifying
    // being written into it by a caller that thought it was being helpful.
    expect(() => store.spend(1, "not-a-hash")).toThrow();
    expect(() => store.spend(1, "s_flY3fwsALmEokLR3qu3PqDxU8Iy")).toThrow();
    expect(() => store.spend(1, "A".repeat(64))).toThrow(); // uppercase
    expect(() => store.spend(1, "a".repeat(63))).toThrow();
    expect(() => store.spend(1, "")).toThrow();
  });
});

describe("double spending", () => {
  const hash = (seed: string) =>
    Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64);

  it("accepts a nullifier once and refuses it after", () => {
    const store = new NullifierStore();
    expect(store.spend(10, hash("abc")).fresh).toBe(true);
    expect(store.spend(10, hash("abc")).fresh).toBe(false);
    expect(store.spend(10, hash("abc")).fresh).toBe(false);
  });

  it("checks and records in one operation", () => {
    // A caller that read first and wrote second would have a window in which
    // two concurrent redemptions of the same token both saw "unspent". The
    // API does not offer a read, so a caller cannot write that bug.
    const store = new NullifierStore();
    expect(Object.getOwnPropertyNames(NullifierStore.prototype)).not.toContain(
      "has",
    );
    expect(store.spend(1, hash("ab")).fresh).toBe(true);
  });

  it("does not confuse two different tokens", () => {
    const store = new NullifierStore();
    expect(store.spend(10, hash("abc")).fresh).toBe(true);
    expect(store.spend(10, hash("def")).fresh).toBe(true);
  });
});

describe("the set is bounded in time, not merely small", () => {
  const hash = (seed: string) =>
    Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64);

  it("keeps exactly the live epochs and drops the rest whole", () => {
    const store = new NullifierStore(2);
    store.spend(10, hash("a"));
    store.spend(11, hash("b"));
    expect(store.liveEpochs()).toEqual([10, 11]);

    store.spend(12, hash("c"));
    // Epoch 10's signing key is retired at the same moment, so a token from it
    // can no longer verify and nothing needs to remember it was spent.
    expect(store.liveEpochs()).toEqual([11, 12]);
    expect(store.size()).toBe(2);
  });

  it("forgets an old spend rather than growing forever", () => {
    const store = new NullifierStore(2);
    store.spend(10, hash("a"));
    store.spend(12, hash("b"));
    // The same nullifier is "fresh" again — which is safe only because the key
    // that could have signed it no longer exists. This test is here to make
    // that dependency explicit: shortening key lifetime without shortening
    // this window, or the reverse, is how a replay window opens.
    expect(store.spend(12, hash("a")).fresh).toBe(true);
  });

  it("has a size that depends on recent traffic and nothing else", () => {
    const store = new NullifierStore(2);
    for (let epoch = 0; epoch < 50; epoch += 1) {
      store.spend(epoch, hash(`e${epoch}`));
    }
    // Fifty epochs of traffic, two epochs of memory.
    expect(store.size()).toBe(2);
    expect(store.liveEpochs()).toEqual([48, 49]);
  });
});
