import { describe, expect, it } from "vitest";

import {
  LEGACY_SUBJECT_METADATA_KEYS,
  SUBJECT_METADATA_KEY,
  SUBJECT_METADATA_KEYS,
  subjectFromMetadata,
} from "@/lib/stripe/types";

/**
 * Contract 1, from the direction that bites during a rename.
 *
 * The platform holds no subject-to-customer map — Stripe does, in customer
 * metadata, under a key named after the platform. That makes the key name a
 * piece of *stored data the platform does not own*. Rename the platform and
 * the constant changes; the bytes already in Stripe do not.
 *
 * The failure is silent and expensive: `findCustomerBySubject` misses, the
 * reader is treated as brand new, a second customer is created next to their
 * live subscription, and they are downgraded to Reader while still being
 * billed. This platform went through exactly that rename
 * (`receptorome` → `cephroom`), so these assertions exist to make a future one
 * fail loudly at `npm test` rather than quietly in production.
 */
describe("a platform rename does not orphan returning subscribers", () => {
  it("still searches every metadata key the platform has ever used", () => {
    // Dropping a name here is what orphans people. Adding one is free.
    expect(SUBJECT_METADATA_KEYS).toContain("receptoromeSub");
    expect(SUBJECT_METADATA_KEYS).toContain(SUBJECT_METADATA_KEY);
  });

  it("tries the current key first, so the common case costs one lookup", () => {
    expect(SUBJECT_METADATA_KEYS[0]).toBe(SUBJECT_METADATA_KEY);
  });

  it("never writes under a legacy key", () => {
    expect(LEGACY_SUBJECT_METADATA_KEYS).not.toContain(SUBJECT_METADATA_KEY);
  });

  it("reads a subject stored under the pre-rename key", () => {
    const asStripeHoldsIt = { receptoromeSub: "s_flY3fwsALmEokLR3qu3PqDxU8Iy" };
    expect(subjectFromMetadata(asStripeHoldsIt)).toBe(
      "s_flY3fwsALmEokLR3qu3PqDxU8Iy",
    );
  });

  it("reads a subject stored under the current key", () => {
    expect(subjectFromMetadata({ [SUBJECT_METADATA_KEY]: "s_new" })).toBe(
      "s_new",
    );
  });

  it("prefers the current key when a customer carries both", () => {
    // A migrated customer may transiently carry both. The current one wins,
    // and they must agree anyway — this asserts which is authoritative.
    const both = {
      [SUBJECT_METADATA_KEY]: "s_current",
      receptoromeSub: "s_legacy",
    };
    expect(subjectFromMetadata(both)).toBe("s_current");
  });

  it("returns null rather than guessing for a customer that is not ours", () => {
    expect(subjectFromMetadata({})).toBeNull();
    expect(subjectFromMetadata(null)).toBeNull();
    expect(subjectFromMetadata({ someOtherProduct: "s_x" })).toBeNull();
  });
});

/**
 * The same guarantee, exercised through the gateway the platform actually
 * calls rather than through the helper. A customer written before the rename
 * must resolve to the *same* customer id afterwards, and must then be
 * migrated forward so the legacy search is paid once.
 */
describe("the simulated counterparty resolves a pre-rename customer", () => {
  it("finds it, returns the same id, and migrates the key forward", async () => {
    const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    // The store reads .stripe-simulated.json out of process.cwd(), so point
    // cwd at a scratch copy holding a customer as the old build wrote it.
    const scratch = mkdtempSync(join(tmpdir(), "cephroom-rename-"));
    const before = {
      customers: {
        cus_legacy: {
          id: "cus_legacy",
          metadata: { receptoromeSub: "s_returning_reader" },
        },
      },
      subscriptions: {},
      sessions: {},
    };
    writeFileSync(
      join(scratch, ".stripe-simulated.json"),
      JSON.stringify(before),
    );

    const cwd = process.cwd();
    process.chdir(scratch);
    try {
      const { simulatedGateway } = await import(
        "../../simulated-counterparties/stripe/store"
      );
      const found = await simulatedGateway().findCustomerBySubject(
        "s_returning_reader",
      );

      // The whole point: same subject in, same customer out.
      expect(found).toBe("cus_legacy");

      const after = JSON.parse(
        readFileSync(join(scratch, ".stripe-simulated.json"), "utf8"),
      );
      expect(after.customers.cus_legacy.metadata[SUBJECT_METADATA_KEY]).toBe(
        "s_returning_reader",
      );

      // And a second lookup, now on the current key, still answers.
      expect(
        await simulatedGateway().findCustomerBySubject("s_returning_reader"),
      ).toBe("cus_legacy");
    } finally {
      process.chdir(cwd);
    }
  });
});
