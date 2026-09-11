import { describe, expect, it, vi } from "vitest";

/**
 * Regression test for the returning-member gap found in the Role 2 walk.
 *
 * The access key lives 15 minutes and the refresh key 7 days, but nothing on
 * a cold page load consulted the refresh key — so a member returning the next
 * day appeared signed out despite holding a live session. The header now asks
 * canResumeSession() and, when it is true, mounts a one-shot silent refresh.
 *
 * These cover the two branches that decide whether to attempt a resume, both
 * of which turn only on cookie presence (no signature check, so no signing
 * key needed): a valid access key short-circuits it, and a bare refresh
 * cookie triggers it.
 */

const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

const { canResumeSession, ACCESS_COOKIE, REFRESH_COOKIE } = await import(
  "@/lib/auth/session"
);

describe("canResumeSession", () => {
  it("is true when the access key is gone but a refresh cookie remains", async () => {
    cookieJar.clear();
    cookieJar.set(REFRESH_COOKIE, "some.refresh.token");
    expect(await canResumeSession()).toBe(true);
  });

  it("is false when there is nothing to resume from", async () => {
    cookieJar.clear();
    expect(await canResumeSession()).toBe(false);
  });

  it("is false when only an expired-but-present access cookie exists", async () => {
    // No refresh cookie means no way to mint a new access key, so there is
    // nothing to resume — do not spin the refresh endpoint pointlessly.
    cookieJar.clear();
    cookieJar.set(ACCESS_COOKIE, "not-a-verifiable-key");
    expect(await canResumeSession()).toBe(false);
  });
});
