import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ROOT } from "./scan";
import { NullifierStore } from "@/lib/tokens/nullifiers";

describe("a nullifier entry can hold nothing but the fact that it exists", () => {
  it("stores entries in a Set, which has no room for a payload", () => {
    const source = readFileSync(
      join(ROOT, "src", "lib", "tokens", "nullifiers.ts"),
      "utf8",
    );

    expect(source).toMatch(/Map<number,\s*Set<Nullifier>>/);
    expect(source).not.toMatch(/Map<Nullifier,/);
    expect(source).not.toMatch(/Map<string,\s*\{/);
  });

  it("names no field that could carry identity or time", () => {
    const source = readFileSync(
      join(ROOT, "src", "lib", "tokens", "nullifiers.ts"),
      "utf8",
    );
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
    expect(() => store.spend(1, "not-a-hash")).toThrow();
    expect(() => store.spend(1, "s_flY3fwsALmEokLR3qu3PqDxU8Iy")).toThrow();
    expect(() => store.spend(1, "A".repeat(64))).toThrow();
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
    expect(store.liveEpochs()).toEqual([11, 12]);
    expect(store.size()).toBe(2);
  });

  it("forgets an old spend rather than growing forever", () => {
    const store = new NullifierStore(2);
    store.spend(10, hash("a"));
    store.spend(12, hash("b"));
    expect(store.spend(12, hash("a")).fresh).toBe(true);
  });

  it("has a size that depends on recent traffic and nothing else", () => {
    const store = new NullifierStore(2);
    for (let epoch = 0; epoch < 50; epoch += 1) {
      store.spend(epoch, hash(`e${epoch}`));
    }
    expect(store.size()).toBe(2);
    expect(store.liveEpochs()).toEqual([48, 49]);
  });
});
