import { describe, expect, it, vi } from "vitest";


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
    cookieJar.clear();
    cookieJar.set(ACCESS_COOKIE, "not-a-verifiable-key");
    expect(await canResumeSession()).toBe(false);
  });
});
