import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchWithTimeout } from "./fetch-with-timeout";

afterEach(() => vi.restoreAllMocks());

describe("fetchWithTimeout", () => {
  it("returns the response when the fetch settles in time", async () => {
    const ok = new Response("ok", { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok));
    const res = await fetchWithTimeout("http://node/x", {}, 1000);
    expect(res.status).toBe(200);
  });

  it("aborts and throws a readable error when the node hangs", async () => {
    // A node that never responds: fetch rejects with an AbortError once the
    // controller fires. The reader turns this into "node stopped answering"
    // instead of spinning forever.
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }),
    );
    await expect(fetchWithTimeout("http://node/x", {}, 20)).rejects.toThrow(
      /no response within/,
    );
  });

  it("passes an abort signal to the underlying fetch", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", spy);
    await fetchWithTimeout("http://node/x", { method: "GET" }, 1000);
    expect(spy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(spy.mock.calls[0][1].method).toBe("GET");
  });
});
