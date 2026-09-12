"use client";


export const NODE_FETCH_TIMEOUT_MS = 8000;

/**
 * Every request to a node goes through here, and the credentials setting is
 * the reason - contract 2.
 *
 * A node's address is stated by whoever announced it and relayed unchecked,
 * which is contract 4 working as intended. The consequence is that this URL is
 * attacker-controlled: a contributor can announce the platform's own origin, or
 * a node can redirect to it. fetch defaults to credentials "same-origin", so
 * either of those would attach the reader's session cookie to a request the
 * reader never chose to make.
 *
 * /privacy says reading sends a node no key at all. Omitting credentials here,
 * where it cannot be overridden by a caller, is what makes that unconditionally
 * true rather than true of the addresses we happened to test.
 *
 * An explicit authorization header is still honoured: a node key is scoped to
 * one contributor and useless anywhere else. It is the ambient cookie - which
 * travels without anyone deciding it should - that must never leave.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = NODE_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      referrerPolicy: "no-referrer",
      ...init,
      credentials: "omit",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`no response within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
