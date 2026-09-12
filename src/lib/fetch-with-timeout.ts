"use client";

/**
 * Marked client-side, which it already was in fact.
 *
 * Every caller is a client component fetching a contributor's node, and that
 * is load-bearing rather than incidental: bytes go from the author's machine
 * to the reader's, and the platform is not in the request. A module that can
 * reach the network and can also be imported by a server component is one
 * import away from putting those bytes through the platform's memory.
 *
 * Saying so here makes the boundary something the build enforces and
 * `tests/contracts/no-remote-state.test.ts` can see, rather than a fact about
 * who currently happens to import it.
 */

export const NODE_FETCH_TIMEOUT_MS = 8000;

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = NODE_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    // A DOMException named AbortError means we timed out; give it a message a
    // reader can understand rather than the opaque default.
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`no response within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
