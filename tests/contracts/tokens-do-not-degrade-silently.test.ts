import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { keyFingerprint } from "@/lib/tokens/issuer";

const STORAGE_KEY = "cephroom.tokens.v1";

const LIVE_KEY = Buffer.from("a live issuer public key").toString("base64");
const RETIRED_KEY = Buffer.from("the key a restart threw away").toString("base64");

interface Stored {
  [key: string]: string;
}

function installBrowser(): Stored {
  const store: Stored = {};
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    },
  };
  return store;
}

function publishedKeysResponse(publicKey: string) {
  return {
    ok: true,
    json: async () => ({
      keys: [{ tier: "query", epoch: 100, publicKey, tokenType: 2 }],
    }),
  };
}

let store: Stored;

beforeEach(() => {
  store = installBrowser();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as unknown as { window?: unknown }).window;
});

async function seedWallet(publicKey: string, tokens: string[]) {
  store[STORAGE_KEY] = JSON.stringify({
    tier: "query",
    epoch: 100,
    tokens,
    issuer: await keyFingerprint(publicKey),
  });
}

describe("a batch the platform can no longer honour is not reported as stock", () => {
  it("reports the batch stale rather than counting it as healthy tokens", async () => {
    await seedWallet(RETIRED_KEY, ["t1", "t2", "t3"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => publishedKeysResponse(LIVE_KEY)),
    );

    const { walletHealth } = await import("@/lib/tokens/wallet");
    const health = await walletHealth();

    expect(health.stale).toBe(true);
    expect(health.usable).toBe(0);
    expect(health.holding).toBe(3);
  });

  it("reports a batch signed by a still-published key as usable", async () => {
    await seedWallet(LIVE_KEY, ["t1", "t2"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => publishedKeysResponse(LIVE_KEY)),
    );

    const { walletHealth } = await import("@/lib/tokens/wallet");
    const health = await walletHealth();

    expect(health.stale).toBe(false);
    expect(health.usable).toBe(2);
  });

  it("discards a stale batch rather than spending from it", async () => {
    await seedWallet(RETIRED_KEY, ["t1", "t2"]);
    const fetchMock = vi.fn(async (url: string) =>
      publishedKeysResponse(String(url).includes("keys") ? LIVE_KEY : LIVE_KEY),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { spendToken } = await import("@/lib/tokens/wallet");
    const outcome = await spendToken();

    expect(outcome.kind).toBe("stale");
    expect(store[STORAGE_KEY]).toBeUndefined();
    const requested = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requested.some((url) => url.includes("/api/tokens/redeem"))).toBe(
      false,
    );
  });
});

describe("a token is not lost when redemption does not succeed", () => {
  it("keeps the token in the wallet when the platform is unreachable", async () => {
    await seedWallet(LIVE_KEY, ["t1", "t2"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/tokens/keys")) {
          return publishedKeysResponse(LIVE_KEY);
        }
        throw new Error("network down");
      }),
    );

    const { spendToken } = await import("@/lib/tokens/wallet");
    const outcome = await spendToken();

    expect(outcome.kind).toBe("unreachable");
    expect(JSON.parse(store[STORAGE_KEY]).tokens).toEqual(["t1", "t2"]);
  });

  it("drops only the refused token when the platform refuses one", async () => {
    await seedWallet(LIVE_KEY, ["t1", "t2"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/tokens/keys")) {
          return publishedKeysResponse(LIVE_KEY);
        }
        return { ok: false, status: 400, json: async () => ({}) };
      }),
    );

    const { spendToken } = await import("@/lib/tokens/wallet");
    const outcome = await spendToken();

    expect(outcome.kind).toBe("refused");
    expect(JSON.parse(store[STORAGE_KEY]).tokens).toEqual(["t2"]);
  });

  it("removes the token only once redemption has actually succeeded", async () => {
    await seedWallet(LIVE_KEY, ["t1", "t2"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/tokens/keys")) {
          return publishedKeysResponse(LIVE_KEY);
        }
        return {
          ok: true,
          json: async () => ({ key: "an-anonymous-key", tier: "query" }),
        };
      }),
    );

    const { spendToken } = await import("@/lib/tokens/wallet");
    const outcome = await spendToken();

    expect(outcome).toMatchObject({ kind: "spent", key: "an-anonymous-key" });
    expect(JSON.parse(store[STORAGE_KEY]).tokens).toEqual(["t2"]);
  });
});

describe("the fingerprint is what ties a batch to an issuer key", () => {
  it("is stored with the batch, so a rotation is detectable without asking us", async () => {
    await seedWallet(LIVE_KEY, ["t1"]);
    expect(JSON.parse(store[STORAGE_KEY]).issuer).toBe(
      await keyFingerprint(LIVE_KEY),
    );
  });

  it("differs for a different issuer key", async () => {
    expect(await keyFingerprint(LIVE_KEY)).not.toBe(
      await keyFingerprint(RETIRED_KEY),
    );
  });

  it("is stable for the same key", async () => {
    expect(await keyFingerprint(LIVE_KEY)).toBe(await keyFingerprint(LIVE_KEY));
  });

  it("treats a wallet written before fingerprints existed as stale", async () => {
    store[STORAGE_KEY] = JSON.stringify({
      tier: "query",
      epoch: 100,
      tokens: ["t1", "t2"],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => publishedKeysResponse(LIVE_KEY)),
    );

    const { walletHealth } = await import("@/lib/tokens/wallet");
    expect((await walletHealth()).stale).toBe(true);
  });
});

describe("the residual is stated rather than left to be discovered", () => {
  it("says on the privacy page that a batch can die and the fallback is identified", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT } = await import("./scan");

    const privacy = readFileSync(
      join(ROOT, "src", "app", "privacy", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");

    expect(privacy).toMatch(/rotate hourly|retires every token/i);
    expect(privacy).toMatch(/fingerprint/i);
    expect(privacy).toMatch(/your search still goes out with your ordinary key/i);
  });

  it("does not describe the residual as fixed", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT } = await import("./scan");

    const privacy = readFileSync(
      join(ROOT, "src", "app", "privacy", "page.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");

    expect(privacy).toMatch(/that is not built|is not built/i);
  });

  it("tells the reader on the result itself, not only on the key page", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT } = await import("./scan");

    const search = readFileSync(
      join(ROOT, "src", "components", "live-search.tsx"),
      "utf8",
    );

    expect(search).toContain("SPEND_NOTE");
    for (const outcome of ["stale", "refused", "unreachable", "empty"]) {
      expect(search, `no note for a ${outcome} spend`).toContain(`${outcome}:`);
    }
  });

  it("does not report a dead batch as healthy stock on the key page", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT } = await import("./scan");

    const wallet = readFileSync(
      join(ROOT, "src", "components", "token-wallet.tsx"),
      "utf8",
    );

    expect(wallet).toContain("walletHealth");
    expect(wallet).toMatch(/health\?\.stale|health\.stale/);
    expect(wallet, "the wallet still counts raw tokens held").not.toMatch(
      /walletCount\(\)/,
    );
  });
});
